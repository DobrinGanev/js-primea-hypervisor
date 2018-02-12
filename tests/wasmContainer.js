const tape = require('tape')
const fs = require('fs')
const Message = require('../message.js')
const Hypervisor = require('../')
const WasmContainer = require('../wasmContainer.js')

const level = require('level-browserify')
const RadixTree = require('dfinity-radix-tree')
const db = level('./testdb')

let tester

class TestWasmContainer extends WasmContainer {
  constructor (actor) {
    super(actor)
    this._storage = new Map()
  }
  getInteface (funcRef) {
    const orginal = super.getInteface(funcRef)
    return Object.assign(orginal, {
      test: {
        check: (a, b) => {
          tester.equals(a, b)
        }
      }
    })
  }
  setState (key, ref) {
    const obj = this.refs.get(ref)
    this._storage.set(key, obj)
  }
  getState (key) {
    const obj = this._storage.get(key)
    return this.refs.add(obj)
  }
}

tape('basic', async t => {
  t.plan(2)
  tester = t
  const expectedState = {
    '/': Buffer.from('4494963fb0e02312510e675fbca8b60b6e03bd00', 'hex')
  }

  const tree = new RadixTree({
    db
  })

  const wasm = fs.readFileSync('./wasm/reciever.wasm')

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(TestWasmContainer)

  const {exports} = await hypervisor.createActor(TestWasmContainer.typeId, wasm)

  const message = new Message({
    funcRef: exports.receive,
    funcArguments: [5]
  })
  hypervisor.send(message)
  const stateRoot = await hypervisor.createStateRoot()
  t.deepEquals(stateRoot, expectedState, 'expected root!')
})

tape('two communicating actors', async t => {
  t.plan(2)
  tester = t
  const expectedState = {
    '/': Buffer.from('f3cc5ba63d6b1737bea2c33bd1942e5488787b82', 'hex')
  }

  const tree = new RadixTree({
    db
  })

  const recieverWasm = fs.readFileSync('./wasm/reciever.wasm')
  const callerWasm = fs.readFileSync('./wasm/caller.wasm')

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(TestWasmContainer)

  const {exports: receiverExports} = await hypervisor.createActor(TestWasmContainer.typeId, recieverWasm)
  const {exports: callerExports} = await hypervisor.createActor(TestWasmContainer.typeId, callerWasm)

  const message = new Message({
    funcRef: callerExports.call,
    funcArguments: [receiverExports.receive]
  })

  hypervisor.send(message)
  const stateRoot = await hypervisor.createStateRoot()
  t.deepEquals(stateRoot, expectedState, 'expected root!')
})

// Increment a counter.
tape.skip('increment', async t => {
  const tree = new RadixTree({
    db
  })

  const wasm = fs.readFileSync('./wasm/counter.wasm')

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(TestWasmContainer)

  const {exports} = await hypervisor.createActor(TestWasmContainer.typeId, wasm)

  const message = new Message({
    funcRef: exports.increment,
    funcArguments: []
  })
  hypervisor.send(message)

  const stateRoot = await hypervisor.createStateRoot()
  t.end()

  console.log(stateRoot)

})
