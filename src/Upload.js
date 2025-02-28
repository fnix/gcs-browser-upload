import { put } from 'axios'
import pRetry from 'p-retry'

import FileMeta from './FileMeta'
import FileProcessor from './FileProcessor'
import debug from './debug'
import {
  DifferentChunkError,
  FileAlreadyUploadedError,
  UrlNotFoundError,
  UploadFailedError,
  UnknownResponseError,
  MissingOptionsError,
  UploadIncompleteError,
  InvalidChunkSizeError,
  UploadAlreadyFinishedError
} from './errors'
import * as errors from './errors'

const MIN_CHUNK_SIZE = 5242880 // 5mb

export default class Upload {
  static errors = errors;

  constructor (args, allowSmallChunks) {
    var opts = {
      chunkSize: MIN_CHUNK_SIZE,
      storage: window.localStorage,
      contentType: 'text/plain',
      onChunkUpload: () => { },
      id: null,
      url: null,
      file: null,
      retries: 10,
      ...args
    }

    if ((opts.chunkSize % MIN_CHUNK_SIZE !== 0 || opts.chunkSize === 0) && !allowSmallChunks) {
      throw new InvalidChunkSizeError(opts.chunkSize)
    }

    if (!opts.id || !opts.url || !opts.file) {
      throw new MissingOptionsError()
    }

    debug('Creating new upload instance:')
    debug(` - Url: ${opts.url}`)
    debug(` - Id: ${opts.id}`)
    debug(` - File size: ${opts.file.size}`)
    debug(` - Chunk size: ${opts.chunkSize}`)

    this.opts = opts
    this.meta = new FileMeta(opts.id, opts.file.size, opts.chunkSize, opts.storage)
    this.processor = new FileProcessor(opts.file, this.meta, opts.chunkSize)
    this.lastResult = null
  }

  async start () {
    const { meta, processor, opts, finished } = this

    const resumeUpload = async () => {
      const localResumeIndex = meta.getResumeIndex()
      const remoteResumeIndex = await getRemoteResumeIndex()

      const resumeIndex = Math.min(localResumeIndex, remoteResumeIndex)
      debug(`Validating chunks up to index ${resumeIndex}`)
      debug(` - Remote index: ${remoteResumeIndex}`)
      debug(` - Local index: ${localResumeIndex}`)

      try {
        let startResumeIndex = resumeIndex - 2
        if (startResumeIndex < 0) startResumeIndex = 0

        await processor.run(validateChunk, startResumeIndex, resumeIndex)
      } catch (e) {
        debug('Validation failed, starting from scratch')
        debug(` - Failed chunk index: ${e.chunkIndex}`)
        debug(` - Old checksum: ${e.originalChecksum}`)
        debug(` - New checksum: ${e.newChecksum}`)

        await processor.run(uploadChunk)
        return
      }

      debug('Validation passed, resuming upload')
      await processor.run(uploadChunk, resumeIndex)
    }

    const uploadChunk = async (checksum, state, index, chunk) => {
      const total = opts.file.size
      const start = index * opts.chunkSize
      const end = index * opts.chunkSize + chunk.byteLength - 1

      const options = {
        headers: {
          'Content-Type': opts.contentType,
          'Content-Range': `bytes ${start}-${end}/${total}`
        },
        onUploadProgress: (progressEvent) => {
          opts.onChunkUpload({
            totalBytes: total,
            uploadedBytes: start + progressEvent.loaded,
            chunkIndex: index,
            chunkLength: chunk.byteLength
          })
        },
        validateStatus: false
      }

      debug(`Uploading chunk ${index}:`)
      debug(` - Chunk length: ${chunk.byteLength}`)
      debug(` - Start: ${start}`)
      debug(` - End: ${end}`)

      const res = await pRetry(async () => {
        const current_res = await safePut(opts.url, chunk, options)

        try {
          checkResponseStatus(current_res, opts, [200, 201, 308])
          checkResponseHeaders(current_res, { index, end, checksum })
        } catch (e) {
          if (e instanceof UrlNotFoundError) {
            throw new pRetry.AbortError(e)
          } else {
            throw e
          }
        }

        return current_res
      }, { retries: opts.retries })
      this.lastResult = res
      debug(`Chunk upload succeeded, adding checksum ${checksum}`)
      meta.addChecksum(index, checksum, state)

      opts.onChunkUpload({
        totalBytes: total,
        uploadedBytes: end + 1,
        chunkIndex: index,
        chunkLength: chunk.byteLength
      })
    }

    const validateChunk = async (newChecksum, _state, index) => {
      const originalChecksum = meta.getChecksum(index)
      const isChunkValid = originalChecksum === newChecksum
      if (!isChunkValid) {
        meta.reset()
        throw new DifferentChunkError(index, originalChecksum, newChecksum)
      }
    }

    const getRemoteResumeIndex = async () => {
      const options = {
        headers: {
          'Content-Range': `bytes */${opts.file.size}`
        },
        validateStatus: false
      }
      debug('Retrieving upload status from GCS')
      const res = await safePut(opts.url, null, options)

      checkResponseStatus(res, opts, [308])
      const header = res.headers['range']
      debug(`Received upload status from GCS: ${header}`)
      const range = header.match(/(\d+?)-(\d+?)$/)
      const bytesReceived = parseInt(range[2]) + 1
      return Math.floor(bytesReceived / opts.chunkSize)
    }

    if (finished) {
      throw new UploadAlreadyFinishedError()
    }

    if (meta.isResumable() && meta.getFileSize() === opts.file.size) {
      debug('Upload might be resumable')
      await resumeUpload()
    } else {
      debug('Upload not resumable, starting from scratch')
      await processor.run(uploadChunk)
    }
    debug('Upload complete, resetting meta')
    meta.reset()
    this.finished = true
    return this.lastResult
  }

  pause () {
    this.processor.pause()
    debug('Upload paused')
  }

  unpause () {
    this.processor.unpause()
    debug('Upload unpaused')
  }

  cancel () {
    this.processor.pause()
    this.meta.reset()
    debug('Upload cancelled')
  }
}

function hexToBase64 (hexstring) {
  return btoa(hexstring.match(/\w{2}/g).map(function (a) {
    return String.fromCharCode(parseInt(a, 16))
  }).join(''))
}

function checkResponseStatus (res, opts, allowed = []) {
  const { status } = res
  if (allowed.indexOf(status) > -1) {
    return true
  }

  switch (status) {
    case 308:
      throw new UploadIncompleteError()

    case 201:
    case 200:
      throw new FileAlreadyUploadedError(opts.id, opts.url)

    case 404:
      throw new UrlNotFoundError(opts.url)

    case 500:
    case 502:
    case 503:
    case 504:
      throw new UploadFailedError(status)

    default:
      throw new UnknownResponseError(res)
  }
}

function checkResponseHeaders (res, chunkInfo) {
  const { headers } = res
  const receivedMD5 = headers['x-goog-hash'] || headers['x-range-md5']

  if (!receivedMD5) return

  if (headers['x-goog-hash'] &&
      (chunkInfo.end + 1) === headers['x-goog-stored-content-length'] &&
      receivedMD5.match(/md5=(.*)/)[1] !== hexToBase64(chunkInfo.checksum)) {
    throw new DifferentChunkError(chunkInfo.index, hexToBase64(chunkInfo.checksum), receivedMD5)
  } else if (headers['range']) {
    const range = headers['range'].match(/(\d+?)-(\d+?)$/)
    const bytesReceived = parseInt(range[2])

    if (bytesReceived === chunkInfo.end && receivedMD5 !== chunkInfo.checksum) {
      throw new DifferentChunkError(chunkInfo.index, chunkInfo.checksum, receivedMD5)
    }
  }
}

async function safePut () {
  try {
    return await put.apply(null, arguments)
  } catch (e) {
    if (e instanceof Error) {
      throw e
    } else {
      return e
    }
  }
}
