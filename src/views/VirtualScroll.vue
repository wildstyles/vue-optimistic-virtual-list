<script setup lang="ts">
import { ref, onMounted, onUnmounted, useTemplateRef, watch } from 'vue'
import { faker } from '@faker-js/faker'
import {
  useInfiniteQuery,
  useQueryClient,
  useMutation,
  type InfiniteData,
} from '@tanstack/vue-query'

interface IUser {
  id: number
  name: string
  description: string
}

type QueryFnResult = { items: IUser[]; next?: number }

const QUERY_KEY = 'users'
const ITEMS_PER_PAGE = 15
const ITEMS_COUNT = 30

const sleep = async (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms))

const users = [...Array(ITEMS_COUNT)].map((_, i) => ({
  id: i + 1,
  name: faker.person.fullName(),
  description: faker.lorem.sentence(),
}))

async function addUser(user: IUser) {
  await sleep(3000)

  users.unshift(user)

  // throw new Error(`Failed to add user with id: ${user.id}`)
}

// imitate server-side endpoint with pagination
async function fetchUsers({
  pageParam,
}: {
  pageParam: number
}): Promise<QueryFnResult> {
  console.log(`fetching ${pageParam} page`)
  const pageCount = Math.ceil(users.length / ITEMS_PER_PAGE)

  await sleep(1000)
  const items = users.slice(
    (pageParam - 1) * ITEMS_PER_PAGE,
    pageParam * ITEMS_PER_PAGE,
  )

  return { items, next: pageParam >= pageCount ? undefined : pageParam + 1 }
}

const nextUserId = ref(users.length)
const optimisticallyAddedItemIds = ref<number[]>([])
const queryClient = useQueryClient()
const observer = ref<IntersectionObserver | null>(null)
const trigger = useTemplateRef<HTMLElement>('infinite-trigger')

// watcher on optimisticallyAddedItemIds is used to prevent refetching on every muitation success
// refetch happends then last fired mutation is resolved or rejected
watch(
  () => [...optimisticallyAddedItemIds.value],
  async (v, prev) => {
    if (prev && prev.length && !v.length) {
      await queryClient.invalidateQueries({ queryKey: [QUERY_KEY] })
    }
  },
  { deep: true, immediate: true },
)

const addItemMutation = useMutation({
  onError: err => {
    const id = Number(err.message.split(':')[1])

    optimisticallyAddedItemIds.value.splice(
      optimisticallyAddedItemIds.value.indexOf(id),
      1,
    )
  },
  onSettled: context => {
    optimisticallyAddedItemIds.value.splice(
      optimisticallyAddedItemIds.value.indexOf(context!.id),
      1,
    )
  },
  mutationFn: async () => {
    await queryClient.cancelQueries({ queryKey: [QUERY_KEY] })

    const id = (nextUserId.value += 1)

    const newItem = {
      id,
      name: 'New Item',
      description: faker.lorem.sentence(),
    }

    optimisticallyAddedItemIds.value.push(id)

    const prevData: InfiniteData<QueryFnResult> = queryClient.getQueryData([
      QUERY_KEY,
    ])!

    queryClient.setQueryData<InfiniteData<QueryFnResult>>(
      [QUERY_KEY],
      oldData => {
        const items = [
          // merge optimistic item with old data
          newItem,
          ...(oldData?.pages || []).map(el => el.items).flat(),
        ]

        const updatedPageCount = Math.ceil(items.length / ITEMS_PER_PAGE)
        const pageParams = [...Array(updatedPageCount)].map((_, i) => i + 1)

        // since pages might be shifted, we need to recalculate them
        // and pretent they fetched from server. This is needed for correct further refetching
        const pages = pageParams.map(pageIndex => {
          const next =
            pageParams.length === pageIndex && !hasNextPage.value
              ? undefined
              : pageIndex + 1

          return {
            next,
            items: items.slice(
              (pageIndex - 1) * ITEMS_PER_PAGE,
              pageIndex * ITEMS_PER_PAGE,
            ),
          }
        })

        return { pages, pageParams }
      },
    )

    await addUser(newItem)

    return { id, prevData }
  },
})

const {
  data,
  isLoading,
  fetchNextPage,
  isFetching,
  hasNextPage,
  isRefetching,
  refetch,
  isFetchingNextPage,
} = useInfiniteQuery({
  queryKey: [QUERY_KEY],
  queryFn: fetchUsers,
  initialPageParam: 1,
  getNextPageParam: lastPage => {
    if (!addItemMutation.isPending.value) {
      return lastPage.next
    }

    const prevData: InfiniteData<QueryFnResult> = queryClient.getQueryData([
      'users',
    ])!

    const prevDataLastPage = prevData.pages[prevData.pages.length - 1]

    // if optimistic item creation is still running we can't rely on last page.next generated on mutationFn
    // because in case item is shifted to the next page, "next" param itselft will be "next" + 1.
    // since page is not fully loaded yet we need to subtract 1 from "next" param to fetch correct chunk
    // !!! Leaving "next" - 1 on mutationFn will cause incosistent refresh
    return prevDataLastPage.next
      ? prevDataLastPage.next - 1
      : prevDataLastPage.next
  },
})

const onRefetch = async () => {
  const prevData: InfiniteData<QueryFnResult> = queryClient.getQueryData([
    'users',
  ])!

  // emulate update and deletion happended on server
  // users.splice(1, 1)
  // const index = users.findIndex(user => user.id === 3)
  // users[index] = { ...users[index], name: 'Updated' }

  const result = await refetch()

  // if creation is still running - update all exept optimistically added item
  if (addItemMutation.isPending.value) {
    const refetchedItems = result.data?.pages.map(el => el.items).flat() || []
    const refetchedHasNextPage = // we need this since we can't rely on hasNextPage value - it has old data
      result.data?.pages[result.data.pages.length - 1].next !== undefined
    const prevItems = prevData.pages.map(el => el.items).flat()

    // in case some optimistic items are refetched we don't want duplication and prefer items from refetch
    const notRefetchedOptimisticItemsIds =
      optimisticallyAddedItemIds.value.filter(
        id => !refetchedItems.some(el => el.id === id),
      )

    const optimisticItems = prevItems.filter(el =>
      notRefetchedOptimisticItemsIds.includes(el.id),
    )

    const updatedItems = [...optimisticItems, ...refetchedItems]
    const updatedPageCount = Math.ceil(updatedItems.length / ITEMS_PER_PAGE)

    // reconstructing cache once more
    const pageParams = [...Array(updatedPageCount)].map((_, i) => i + 1)
    const pages = pageParams.map(pageIndex => {
      const next =
        pageParams.length === pageIndex && !refetchedHasNextPage
          ? undefined
          : pageIndex + 1

      return {
        next,
        items: updatedItems.slice(
          (pageIndex - 1) * ITEMS_PER_PAGE,
          pageIndex * ITEMS_PER_PAGE,
        ),
      }
    })

    queryClient.setQueryData([QUERY_KEY], { pages, pageParams })
  }
}

onMounted(() => {
  observer.value = new IntersectionObserver(
    async entries => {
      if (
        entries[0].isIntersecting &&
        hasNextPage.value &&
        !isLoading.value &&
        !isFetching.value
      ) {
        await fetchNextPage()
      }
    },
    { threshold: 0.5 },
  )

  if (trigger.value) {
    observer.value.observe(trigger.value)
  }
})

onUnmounted(() => {
  observer.value?.disconnect()
})
</script>

<template>
  <main>
    <div class="buttons">
      <button @click="() => addItemMutation.mutate()">
        <template v-if="addItemMutation.status.value === 'pending'"
          >Adding item...</template
        >
        <template v-else>Add item</template>
      </button>
      <button @click="() => onRefetch()">
        <template v-if="isRefetching">Refetching...</template
        ><template v-else>Refetch</template>
      </button>
    </div>

    <template v-if="data">
      <template v-for="page in data.pages" :key="page">
        <div class="item" v-for="item in page.items" :key="item.id">
          <h3>
            <strong style="font-weight: bold">{{ item.id }}</strong>
            {{ item.name }}
          </h3>
          <h6>{{ item.description }}</h6>
        </div>
      </template>
    </template>

    <div class="loading-spinner" v-if="isLoading || isFetchingNextPage">
      Loading...
    </div>

    <span ref="infinite-trigger" />
  </main>
</template>

<style>
.buttons {
  margin-bottom: 12px;
  display: flex;
  gap: 8px;
}

.loading-spinner {
  padding: 12px;
  text-align: center;
}

.item {
  border: 1px solid #ccc;
  padding: 12px;
  border-radius: 8px;
}

.item:not(:last-child) {
  margin-bottom: 12px;
}
</style>
