const memoize = require(`memoizee`)
const Stream = require(`stream`).Stream
const spawn = require('child_process').spawn
const which = require('which')

export default class Gifsicle extends Stream {
  constructor(args) {
    super()

    this.args = args
    this.writable = true
    this.readable = true
    this.hasEnded = false
  }

  findBinary = memoize(callback => {
    which(`gifsicle`, (err, path) => {
      if (err) {
        path = require('gifsicle')
      }

      if (path) {
        callback(null, path)
      } else {
        callback(new Error('Unable to locate the gifsicle binary file.'))
      }
    })
  })

  _error = msg => {
    if (!this.hasEnded) {
      this.hasEnded = true
      this.cleanUp()
      this.emit('error', msg)
    }
  }

  write = chunk => {
    if (this.hasEnded) {
      return
    }

    if (this.process) {
      this.process.stdin.write(chunk)
    } else {
      if (!this.bufferedChunks) {
        this.bufferedChunks = []
        this.findBinary((err, binary) => {
          if (this.hasEnded) {
            return
          }

          if (err) {
            return this._error(err)
          }

          this.seenDataOnStdout = false
          this.process = spawn(binary, this.args)

          // error
          this.process.on('error', this._error.bind(this))
          this.process.stdin.on('error', () => {})

          // exit
          this.process.on('exit', exitCode => {
            if (exitCode > 0 && !this.hasEnded) {
              this._error(
                new Error(
                  `The gifsicle process exited with a non-zero exit code: ${exitCode}`
                )
              )
            }
            this.hasEnded = true
          })

          // stdout
          this.process.stdout
            .on('data', chunk => {
              this.seenDataOnStdout = true
              this.emit('data', chunk)
            })
            .on('end', () => {
              this.process = null

              if (!this.hasEnded) {
                if (this.seenDataOnStdout) {
                  this.emit('end')
                } else {
                  this._error(
                    new Error(
                      'Gifsicle: STDOUT stream ended without emitting any data.'
                    )
                  )
                }
                this.hasEnded = true
              }
            })

          if (this.isPaused) {
            this.process.stdout.pause()
          }

          this.bufferedChunks.forEach(chunk => {
            if (chunk === null) {
              this.process.stdin.end()
            } else {
              this.process.stdin.write(chunk)
            }
          })
          this.bufferedChunks = null
        })
      }

      this.bufferedChunks.push(chunk)
    }
  }

  cleanUp = function() {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    this.bufferedChunks = null
  }

  destroy = () => {
    if (!this.hasEnded) {
      this.hasEnded = true
      this.cleanUp()
    }
  }

  end = chunk => {
    if (chunk) {
      this.write(chunk)
    }

    if (this.process) {
      this.process.stdin.end()
    } else {
      if (this.bufferedChunks) {
        this.bufferedChunks.push(null)
      } else {
        this.write(new Buffer(0))
      }
    }
  }

  pause = () => {
    if (this.process) {
      this.process.stdout.pause()
    }
    this.isPaused = true
  }

  resume = () => {
    if (this.process) {
      this.process.stdout.resume()
    }
    this.isPaused = false
  }
}
