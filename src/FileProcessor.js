import { Promise } from 'es6-promise'
import SparkMD5 from 'spark-md5'
import debug from './debug'

class FileProcessor {
  constructor (file, meta, chunkSize) {
    this.paused = false
    this.file = file
    this.meta = meta
    this.chunkSize = chunkSize
    this.unpauseHandlers = []
  }

  async run (fn, startIndex = 0, endIndex) {
    const { file, chunkSize } = this
    const totalChunks = Math.ceil(file.size / chunkSize)
    let spark = new SparkMD5.ArrayBuffer()
    if (startIndex > 0) {
      debug('Restoring SparkMD5 state for the last chunck')
      spark.setState(this.meta.getSparkMD5State(startIndex - 1))
    }

    debug('Starting run on file:')
    debug(` - Total chunks: ${totalChunks}`)
    debug(` - Start index: ${startIndex}`)
    debug(` - End index: ${endIndex || totalChunks}`)

    const processIndex = async (index) => {
      if (index === totalChunks || index === endIndex) {
        debug('File process complete')
        return
      }
      if (this.paused) {
        await waitForUnpause()
      }

      const start = index * chunkSize
      const section = file.slice(start, start + chunkSize)
      const chunk = await getData(file, section)
      const { checksum, state } = computeChecksum(spark, chunk)

      const shouldContinue = await fn(checksum, state, index, chunk)
      if (shouldContinue !== false) {
        await processIndex(index + 1)
      }
    }

    const waitForUnpause = () => {
      return new Promise((resolve) => {
        this.unpauseHandlers.push(resolve)
      })
    }

    await processIndex(startIndex)
  }

  pause () {
    this.paused = true
  }

  unpause () {
    this.paused = false
    this.unpauseHandlers.forEach((fn) => fn())
    this.unpauseHandlers = []
  }
}

function computeChecksum (spark, chunk) {
  spark.append(chunk)
  const state = JSON.stringify(spark.getState())
  const checksum = spark.end()
  spark.setState(JSON.parse(state))
  return { checksum, state }
}

async function getData (file, blob) {
  return new Promise((resolve, reject) => {
    let reader = new window.FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsArrayBuffer(blob)
  })
}

export default FileProcessor
