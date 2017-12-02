const tape = require('tape')
const AbstractContainer = require('primea-abstract-container')
const Message = require('primea-message')
const Hypervisor = require('../')

const level = require('level-browserify')
const RadixTree = require('dfinity-radix-tree')
const db = level('./testdb')

class BaseContainer extends AbstractContainer {
  onCreation () {}
  static get typeId () {
    return 9
  }
}

tape('basic', async t => {
  t.plan(2)
  let message
  const expectedState = {
    '/': Buffer.from('a364c55f9993e0bc63f7155d5eb661ae9ad769d9', 'hex')
  }

  const tree = new RadixTree({
    db: db
  })

  class testVMContainer extends BaseContainer {
    onMessage (m, tag) {
      t.true(m === message, 'should recive a message')
    }
  }

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(testVMContainer)

  let rootCap = await hypervisor.createActor(testVMContainer.typeId, new Message())

  message = new Message()
  hypervisor.send(rootCap, message)

  const stateRoot = await hypervisor.createStateRoot()
  t.deepEquals(stateRoot, expectedState, 'expected root!')
})

tape('two communicating actors', async t => {
  t.plan(2)
  let message
  const expectedState = {
    '/': Buffer.from('9e8d5671e2c7d167e03784e5d9ec36e15747ad95', 'hex')
  }

  const tree = new RadixTree({
    db: db
  })

  class testVMContainerA extends BaseContainer {
    onCreation (m) {
      message = new Message()
      this.actor.send(m.caps[0], message)
    }
  }

  class testVMContainerB extends BaseContainer {
    onMessage (m) {
      t.true(m === message, 'should recive a message')
    }

    static get typeId () {
      return 8
    }
  }

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(testVMContainerA)
  hypervisor.registerContainer(testVMContainerB)

  let capB = await hypervisor.createActor(testVMContainerB.typeId, new Message())
  await hypervisor.createActor(testVMContainerA.typeId, new Message({
    caps: [capB]
  }))

  const stateRoot = await hypervisor.createStateRoot()
  t.deepEquals(stateRoot, expectedState, 'expected root!')
})

tape('three communicating actors', async t => {
  t.plan(3)
  let message
  const expectedState = {
    '/': Buffer.from('840607eafe779858648d3311039f986e68f4752e', 'hex')
  }

  const tree = new RadixTree({
    db: db
  })

  class testVMContainerA extends BaseContainer {
    onCreation (m) {
      message = new Message()
      this.actor.send(m.caps[0], message)
    }
  }

  class testVMContainerB extends BaseContainer {
    onMessage (m) {
      t.true(m === message, 'should recive a message')
    }

    static get typeId () {
      return 8
    }
  }

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(testVMContainerA)
  hypervisor.registerContainer(testVMContainerB)

  let capB = await hypervisor.createActor(testVMContainerB.typeId, new Message())
  await hypervisor.createActor(testVMContainerA.typeId, new Message({
    caps: [capB]
  }))

  await hypervisor.createActor(testVMContainerA.typeId, new Message({
    caps: [capB]
  }))

  const stateRoot = await hypervisor.createStateRoot()
  t.deepEquals(stateRoot, expectedState, 'expected root!')
})

tape('three communicating actors, with tick counting', async t => {
  t.plan(3)
  let message
  const expectedState = {
    '/': Buffer.from('840607eafe779858648d3311039f986e68f4752e', 'hex')
  }

  const tree = new RadixTree({
    db: db
  })

  let ticks = 1

  class testVMContainerA extends BaseContainer {
    async onCreation (m) {
      this.actor.incrementTicks(ticks)
      ticks++
      message = new Message()
      this.actor.send(m.caps[0], message)
    }
  }

  class testVMContainerB extends BaseContainer {
    onMessage (m) {
      t.true(m, 'should recive a message')
    }

    static get typeId () {
      return 8
    }
  }

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(testVMContainerA)
  hypervisor.registerContainer(testVMContainerB)

  let capB = await hypervisor.createActor(testVMContainerB.typeId, new Message())
  await hypervisor.createActor(testVMContainerA.typeId, new Message({
    caps: [capB]
  }))

  await hypervisor.createActor(testVMContainerA.typeId, new Message({
    caps: [capB]
  }))

  const stateRoot = await hypervisor.createStateRoot()

  t.deepEquals(stateRoot, expectedState, 'expected root!')
})

tape('response caps', async t => {
  t.plan(3)
  let message
  const expectedState = {
    '/': Buffer.from('9e8d5671e2c7d167e03784e5d9ec36e15747ad95', 'hex')
  }

  const tree = new RadixTree({
    db: db
  })

  class testVMContainerA extends BaseContainer {
    onCreation (m) {
      message = new Message()
      message.responseCap = this.actor.mintCap()
      this.actor.send(m.caps[0], message)
    }

    onMessage (m) {
      t.true(m, 'should recive a response message')
    }
  }

  class testVMContainerB extends BaseContainer {
    onMessage (m) {
      t.true(m === message, 'should recive a message')
    }

    static get typeId () {
      return 8
    }
  }

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(testVMContainerA)
  hypervisor.registerContainer(testVMContainerB)

  let capB = await hypervisor.createActor(testVMContainerB.typeId, new Message())
  await hypervisor.createActor(testVMContainerA.typeId, new Message({
    caps: [capB]
  }))

  const stateRoot = await hypervisor.createStateRoot()

  t.deepEquals(stateRoot, expectedState, 'expected root!')
})

tape('response caps for errors', async t => {
  t.plan(3)
  let message
  const expectedState = {
    '/': Buffer.from('9e8d5671e2c7d167e03784e5d9ec36e15747ad95', 'hex')
  }

  const tree = new RadixTree({
    db: db
  })

  class testVMContainerA extends BaseContainer {
    onCreation (m) {
      message = new Message()
      message.responseCap = this.actor.mintCap()
      this.actor.send(m.caps[0], message)
    }

    onMessage (m) {
      t.true(m.data.exceptionError instanceof Error, 'should recive a response message')
    }
  }

  class testVMContainerB extends BaseContainer {
    onMessage (m) {
      t.true(m === message, 'should recive a message')
      throw new Error('test error')
    }

    static get typeId () {
      return 8
    }
  }

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(testVMContainerA)
  hypervisor.registerContainer(testVMContainerB)

  let capB = await hypervisor.createActor(testVMContainerB.typeId, new Message())
  await hypervisor.createActor(testVMContainerA.typeId, new Message({
    caps: [capB]
  }))

  const stateRoot = await hypervisor.createStateRoot()
  t.deepEquals(stateRoot, expectedState, 'expected root!')
})

tape('actor creation', async t => {
  t.plan(2)
  let message
  const expectedState = {
    '/': Buffer.from('b19c67aea0ff97e96df6e2aacbd45b1bd260af30', 'hex')
  }

  const tree = new RadixTree({
    db: db
  })

  class testVMContainerA extends BaseContainer {
    onCreation (m) {
      message = new Message()
      const cap = this.actor.mintCap()
      message.caps.push(cap)
      return this.actor.createActor(testVMContainerB.typeId, message)
    }

    onMessage (m) {
      t.equals(m.data, 'test', 'should recive a response message')
    }
  }

  class testVMContainerB extends BaseContainer {
    onCreation (m) {
      const cap = m.caps[0]
      this.actor.send(cap, new Message({data: 'test'}))
    }

    static get typeId () {
      return 8
    }
  }

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(testVMContainerA)
  hypervisor.registerContainer(testVMContainerB)

  await hypervisor.createActor(testVMContainerA.typeId, new Message())

  const stateRoot = await hypervisor.createStateRoot()
  t.deepEquals(stateRoot, expectedState, 'expected root!')
})

tape('simple message arbiter test', async t => {
  t.plan(4)
  const expectedState = {
    '/': Buffer.from('9e8d5671e2c7d167e03784e5d9ec36e15747ad95', 'hex')
  }

  const tree = new RadixTree({
    db: db
  })

  class testVMContainerA extends BaseContainer {
    onCreation (m) {
      const message1 = new Message({
        data: 'first'
      })
      const message2 = new Message({
        data: 'second'
      })
      const message3 = new Message({
        data: 'third'
      })
      this.actor.send(m.caps[0], message1)
      this.actor.incrementTicks(1)
      this.actor.send(m.caps[0], message2)
      this.actor.incrementTicks(1)
      this.actor.send(m.caps[0], message3)
    }
  }

  let recMsg = 0

  class testVMContainerB extends BaseContainer {
    onMessage (m) {
      if (recMsg === 0) {
        t.equal(m.data, 'first', 'should recive fist message')
      } else if (recMsg === 1) {
        t.equal(m.data, 'second', 'should recive second message')
      } else {
        t.equal(m.data, 'third', 'should recive third message')
      }
      recMsg++
    }

    static get typeId () {
      return 8
    }
  }

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(testVMContainerA)
  hypervisor.registerContainer(testVMContainerB)

  let capB = await hypervisor.createActor(testVMContainerB.typeId, new Message())
  await hypervisor.createActor(testVMContainerA.typeId, new Message({
    caps: [capB]
  }))

  const stateRoot = await hypervisor.createStateRoot()
  t.deepEquals(stateRoot, expectedState, 'expected root!')
})

tape('arbiter test for id comparision', async t => {
  t.plan(4)
  let message
  const expectedState = {
    '/': Buffer.from('840607eafe779858648d3311039f986e68f4752e', 'hex')
  }

  const tree = new RadixTree({
    db: db
  })

  class testVMContainerA extends BaseContainer {
    onCreation (m) {
      message = new Message({
        data: m.data
      })
      this.actor.send(m.caps[0], message)
    }
  }

  let recMsg = 0

  class testVMContainerB extends BaseContainer {
    onMessage (m) {
      if (recMsg === 0) {
        t.equal(m.data, 'first', 'should recive fist message')
      } else if (recMsg === 1) {
        t.equal(m.data, 'second', 'should recive second message')
      } else {
        t.equal(m.data, 'third', 'should recive third message')
      }
      recMsg++
    }

    static get typeId () {
      return 8
    }
  }

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(testVMContainerA)
  hypervisor.registerContainer(testVMContainerB)

  let capB = await hypervisor.createActor(testVMContainerB.typeId, new Message())
  await hypervisor.send(capB, new Message({
    data: 'first'
  }))

  await hypervisor.createActor(testVMContainerA.typeId, new Message({
    caps: [capB],
    data: 'second'
  }))

  await hypervisor.createActor(testVMContainerA.typeId, new Message({
    caps: [capB],
    data: 'third'
  }))

  const stateRoot = await hypervisor.createStateRoot()
  t.deepEquals(stateRoot, expectedState, 'expected root!')
})

tape('basic tagged caps', async t => {
  t.plan(4)
  const expectedState = {
    '/': Buffer.from('d4291da4536544bf90aa473a1148cb29f913d078', 'hex')
  }

  const tree = new RadixTree({
    db: db
  })

  class testVMContainerA extends BaseContainer {
    async onMessage (m) {
      t.true(m, 'should recive first message')
      const rCap = this.actor.mintCap(1)
      const message = new Message()
      message.responseCap = rCap
      this.actor.send(m.caps[0], message)
      const rMessage = await this.actor.inbox.nextTaggedMessage([1], 44)
      t.true(rMessage, 'should recive a response message')
    }
  }

  class testVMContainerB extends BaseContainer {
    onMessage (m) {
      t.true(m, 'should recive a message')
    }

    static get typeId () {
      return 8
    }
  }

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(testVMContainerA)
  hypervisor.registerContainer(testVMContainerB)

  let capA = await hypervisor.createActor(testVMContainerA.typeId, new Message())
  let capB = await hypervisor.createActor(testVMContainerB.typeId, new Message())

  await hypervisor.send(capA, new Message({caps: [capB]}))

  const stateRoot = await hypervisor.createStateRoot()
  t.deepEquals(stateRoot, expectedState, 'expected root!')
})

tape('trying to listen for caps more then once', async t => {
  t.plan(4)
  const expectedState = {
    '/': Buffer.from('d4291da4536544bf90aa473a1148cb29f913d078', 'hex')
  }

  const tree = new RadixTree({
    db: db
  })

  class testVMContainerA extends BaseContainer {
    async onMessage (m) {
      t.true(m, 'should recive first message')
      const rCap = this.actor.mintCap(1)
      const message = new Message({data: 'first'})
      message.responseCap = rCap
      this.actor.send(m.caps[0], message)
      const promise = this.actor.inbox.nextTaggedMessage([1], 44)
      try {
        await this.actor.inbox.nextTaggedMessage([1], 44)
      } catch (e) {
        t.true(e, 'should error if waiting twice')
      }
      return promise
    }
  }

  class testVMContainerB extends BaseContainer {
    onMessage (m) {
      t.true(m, 'should recive a message')
    }

    static get typeId () {
      return 8
    }
  }

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(testVMContainerA)
  hypervisor.registerContainer(testVMContainerB)

  let capA = await hypervisor.createActor(testVMContainerA.typeId, new Message())
  let capB = await hypervisor.createActor(testVMContainerB.typeId, new Message())

  await hypervisor.send(capA, new Message({caps: [capB]}))

  const stateRoot = await hypervisor.createStateRoot()
  t.deepEquals(stateRoot, expectedState, 'expected root!')
})

tape('multple messages to restore on waiting for tags', async t => {
  t.plan(6)
  const expectedState = {
    '/': Buffer.from('b5c0822ccb21bbaa2ad8069c4dcd18add7d6e2d1', 'hex')
  }

  const tree = new RadixTree({
    db: db
  })

  class testVMContainerA extends BaseContainer {
    async onMessage (m) {
      t.true(m, 'should recive first message')
      if (m.caps.length) {
        const cap1 = this.actor.mintCap(1)
        const cap2 = this.actor.mintCap(2)
        const message1 = new Message({
          data: 'first'
        })
        const message2 = new Message({
          data: 'second'
        })
        message1.caps.push(cap1)
        message2.caps.push(cap2)
        this.actor.send(m.caps[0], message1)
        this.actor.send(m.caps[1], message2)
        const rMessage = await this.actor.inbox.nextTaggedMessage([1, 2], 44)
        t.true(rMessage, 'should recive a response message')
      }
    }
  }

  class testVMContainerB extends BaseContainer {
    onMessage (m) {
      t.true(m, 'should recive a message')
      const cap = m.caps[0]
      this.actor.incrementTicks(1)
      this.actor.send(cap, new Message({data: m.data}))
    }

    static get typeId () {
      return 8
    }
  }

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(testVMContainerA)
  hypervisor.registerContainer(testVMContainerB)

  let capA = await hypervisor.createActor(testVMContainerA.typeId, new Message())
  let capB1 = await hypervisor.createActor(testVMContainerB.typeId, new Message())
  let capB2 = await hypervisor.createActor(testVMContainerB.typeId, new Message())

  await hypervisor.send(capA, new Message({caps: [capB1, capB2]}))

  const stateRoot = await hypervisor.createStateRoot()

  t.deepEquals(stateRoot, expectedState, 'expected root!')
})

tape('multple messages to backup on waiting for tags', async t => {
  t.plan(6)
  const expectedState = {
    '/': Buffer.from('b5c0822ccb21bbaa2ad8069c4dcd18add7d6e2d1', 'hex')
  }

  const tree = new RadixTree({
    db: db
  })

  class testVMContainerA extends BaseContainer {
    async onMessage (m) {
      t.true(m, 'should recive first message')
      if (m.caps.length) {
        const cap1 = this.actor.mintCap(1)
        const cap2 = this.actor.mintCap(2)
        const message1 = new Message({
          data: 'first'
        })
        const message2 = new Message({
          data: 'second'
        })
        message1.caps.push(cap1)
        message2.caps.push(cap2)
        this.actor.send(m.caps[0], message1)
        this.actor.send(m.caps[1], message2)
        const rMessage = await this.actor.inbox.nextTaggedMessage([1, 2], 44)
        t.true(rMessage, 'should recive a response message')
      }
    }
  }

  class testVMContainerB extends BaseContainer {
    async onMessage (m) {
      t.true(m, 'should recive a message')
      const cap = m.caps[0]
      this.actor.incrementTicks(1)
      this.actor.send(cap, new Message({data: m.data}))
    }

    static get typeId () {
      return 8
    }
  }

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(testVMContainerA)
  hypervisor.registerContainer(testVMContainerB)

  let capA = await hypervisor.createActor(testVMContainerA.typeId, new Message())
  let capB1 = await hypervisor.createActor(testVMContainerB.typeId, new Message())
  let capB2 = await hypervisor.createActor(testVMContainerB.typeId, new Message())

  await hypervisor.send(capA, new Message({caps: [capB1, capB2]}))

  const stateRoot = await hypervisor.createStateRoot()
  t.deepEquals(stateRoot, expectedState, 'expected root!')
})

tape('multple messages, but single tag', async t => {
  t.plan(6)
  const expectedState = {
    '/': Buffer.from('b5c0822ccb21bbaa2ad8069c4dcd18add7d6e2d1', 'hex')
  }

  const tree = new RadixTree({
    db: db
  })

  class testVMContainerA extends BaseContainer {
    async onMessage (m) {
      t.true(m, 'should recive first message')
      if (m.caps.length) {
        const cap1 = this.actor.mintCap(1)
        const cap2 = this.actor.mintCap(2)
        const message1 = new Message({
          data: 'first'
        })
        const message2 = new Message({
          data: 'second'
        })
        message1.caps.push(cap1)
        message2.caps.push(cap2)
        await this.actor.send(m.caps[0], message1)
        await this.actor.send(m.caps[1], message2)
        const rMessage = await this.actor.inbox.nextTaggedMessage([2], 44)
        t.true(rMessage, 'should recive a response message')
      }
    }
  }

  class testVMContainerB extends BaseContainer {
    async onMessage (m) {
      t.true(m, 'should recive a message')
      const cap = m.caps[0]
      this.actor.incrementTicks(1)
      this.actor.send(cap, new Message({data: m.data}))
    }

    static get typeId () {
      return 8
    }
  }

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(testVMContainerA)
  hypervisor.registerContainer(testVMContainerB)

  let capA = await hypervisor.createActor(testVMContainerA.typeId, new Message())
  let capB1 = await hypervisor.createActor(testVMContainerB.typeId, new Message())
  let capB2 = await hypervisor.createActor(testVMContainerB.typeId, new Message())

  await hypervisor.send(capA, new Message({caps: [capB1, capB2]}))

  const stateRoot = await hypervisor.createStateRoot()
  t.deepEquals(stateRoot, expectedState, 'expected root!')
})

tape('deadlock test', async t => {
  t.plan(7)
  const expectedState = {
    '/': Buffer.from('f290945ad63dd06b9ada924fa5149df4a0a32f53', 'hex')
  }

  const tree = new RadixTree({
    db: db
  })

  class testVMContainerA extends BaseContainer {
    async onMessage (m) {
      t.true(m, 'should recive first message 1')
      const rMessage = await this.actor.inbox.nextTaggedMessage([1], 50)
      t.equals(rMessage, undefined, 'should recive a response message 1')
    }
  }

  class testVMContainerB extends BaseContainer {
    async onMessage (m) {
      t.true(m, 'should recive first message 2')
      this.actor.incrementTicks(47)
      const rMessage = await this.actor.inbox.nextTaggedMessage([1], 1)
      t.equals(rMessage, undefined, 'should recive a response message 2')
    }

    static get typeId () {
      return 8
    }
  }

  class testVMContainerC extends BaseContainer {
    async onMessage (m) {
      t.true(m, 'should recive first message 3')
      this.actor.incrementTicks(45)
      const rMessage = await this.actor.inbox.nextTaggedMessage([1], 1)
      t.equals(rMessage, undefined, 'should recive a response message 3')
    }

    static get typeId () {
      return 7
    }
  }

  const hypervisor = new Hypervisor(tree)
  hypervisor.registerContainer(testVMContainerA)
  hypervisor.registerContainer(testVMContainerB)
  hypervisor.registerContainer(testVMContainerC)

  let capA = await hypervisor.createActor(testVMContainerA.typeId, new Message())
  let capB = await hypervisor.createActor(testVMContainerB.typeId, new Message())
  let capC = await hypervisor.createActor(testVMContainerC.typeId, new Message())

  await Promise.all([
    hypervisor.send(capA, new Message()),
    hypervisor.send(capB, new Message()),
    hypervisor.send(capC, new Message())
  ])
  const stateRoot = await hypervisor.createStateRoot()
  t.deepEquals(stateRoot, expectedState, 'expected root!')
})
