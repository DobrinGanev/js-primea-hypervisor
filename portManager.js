const Port = require('./port.js')
const ENTRY = Symbol('entry')

// decides which message to go firts
function messageArbiter (pairA, pairB) {
  const a = pairA[1].peek()
  const b = pairB[1].peek()

  if (!a) {
    return pairB
  } else if (!b) {
    return pairA
  }

  const aGasPrice = a.resources.gasPrice
  const bGasPrice = b.resources.gasPrice
  if (a.ticks !== b.ticks) {
    return a.ticks < b.ticks ? pairA : pairB
  } else if (aGasPrice === bGasPrice) {
    return a.hash() > b.hash() ? pairA : pairB
  } else {
    return aGasPrice > bGasPrice ? pairA : pairB
  }
}

module.exports = class PortManager {
  constructor (opts) {
    Object.assign(this, opts)
    this._portMap = new Map()
  }

  async start () {
    // map ports to thier id's
    let ports = Object.keys(this.ports).map(name => {
      const port = this.ports[name]
      this._mapPort(name, port)
    })

    // create the parent port
    await Promise.all(ports)
    const id = await this.hypervisor.generateID(this.parentPort)
    this._portMap.set(id, new Port(ENTRY))
  }

  async _mapPort (name, port) {
    const id = await this.hypervisor.generateID(port)
    port = new Port(name)
    this._portMap.set(id, port)
  }

  queue (message) {
    this._portMap.get(message.fromPort).queue(message)
  }

  set (name, port) {
    this.ports[name] = port
    return this._mapPort(name, port)
  }

  async get (port) {
    const id = await this.hypervisor.generateID(port)
    return this._portMap.get(id)
  }

  getRef (key) {
    return this.ports[key]
  }

  // waits till all ports have reached a threshold tick count
  async wait (threshold, fromPort) {
    // console.log('wait', threshold, 'id', this.entryPort)
    // find the ports that have a smaller tick count then the threshold tick count
    const unkownPorts = [...this._portMap].filter(([id, port]) => {
      return (port.hasSent || port.name === ENTRY) &&
        port.ticks < threshold &&
        fromPort !== port
    })

    const promises = unkownPorts.map(async ([id, port]) => {
      const portObj = port.name === ENTRY ? this.parentPort : this.ports[port.name]
      // update the port's tick count
      port.ticks = await this.hypervisor.wait(portObj, threshold, this.entryPort)
    })
    return Promise.all(promises)
  }

  async getNextMessage () {
    await this.wait(this.kernel.ticks, this.entryPort)
    const portMap = [...this._portMap].reduce(messageArbiter)
    if (portMap) {
      return portMap[1].shift()
    }
  }
}
