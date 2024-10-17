<script setup lang="ts">
import { faker } from '@faker-js/faker'
import { ref } from 'vue'
import { Server, WebSocket } from 'mock-socket'

function randomInteger(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

const fakeURL = 'ws://localhost:8080'

type Button = {
  text: string
}

const buttons = ref<Button[]>([])
// emulation of chunk load when the window is not focused
const aggregatedButtons = ref<Array<Button[]>>([])

const updateQueue = ref<Button[] | null>(null)
const updateInProgress = ref(false)

const isWindowFocused = ref(true)

const server = new Server(fakeURL)

server.on('connection', socket => {
  setInterval(() => {
    const data = [...Array(randomInteger(1, 5))].map(() => ({
      text: faker.word.verb(),
    }))

    if (isWindowFocused.value) {
      // as soon as the window is focused, send all the aggregated messages
      aggregatedButtons.value.forEach(aggregatedData => {
        socket.send(JSON.stringify(aggregatedData))
      })

      aggregatedButtons.value = []

      socket.send(JSON.stringify(data))
    } else {
      aggregatedButtons.value.push(data)
    }
  }, 1000)
})

const applyUpdates = () => {
  if (updateQueue.value !== null) {
    buttons.value = updateQueue.value
    updateQueue.value = null
    updateInProgress.value = false
  }
}

const client = new WebSocket(fakeURL)

// emulate the client's connection to the server
client.onmessage = event => {
  const update = JSON.parse(event.data)

  updateQueue.value = update

  if (!updateInProgress.value) {
    updateInProgress.value = true

    requestAnimationFrame(applyUpdates)
  }
}

window.onblur = () => {
  isWindowFocused.value = false
}

window.onfocus = () => {
  isWindowFocused.value = true
}
</script>

<template>
  <h1>Socket optimisation</h1>

  <button v-for="button in buttons" :key="button.text">
    {{ button.text }}
  </button>
</template>
