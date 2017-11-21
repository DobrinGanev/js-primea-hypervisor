const binarySearchInsert = require('binary-search-insert')
const SortedMap = require('sortedmap')
const LockMap = require('lockmap')

function comparator (a, b) {
  return a.ticks - b.ticks
}

module.exports = class Scheduler {
  /**
   * The Scheduler manages the run cycle of Actors and figures out which
   * order they should run in
   */
  constructor () {
    this._waits = []
    this._running = new Set()
    this._loadingInstances = new LockMap()
    this._checkingWaits = false
    this.instances = new SortedMap(comparator)
  }

  /**
   * locks the scheduler from clearing waits untill the lock is resolved
   * @param {string} id
   * @return {function} the resolve function to call once it to unlock
   */
  lock (id) {
    return this._loadingInstances.lock(id)
  }

  /**
   * updates an instance with a new tick count
   * @param {Object} instance - an actor instance
   */
  update (instance) {
    this._waits = this._waits.filter(wait => wait.id !== instance.id)
    this._update(instance)
    this._running.add(instance.id)
    this._checkWaits()
  }

  _update (instance) {
    this.instances.delete(instance.id)
    this.instances.set(instance.id, instance)
  }

  /**
   * returns an Actor instance
   * @param {String} id
   * @return {Object}
   */
  getInstance (id) {
    return this.instances.get(id) || this._loadingInstances.get(id)
  }

  /**
   * deletes an instance from the scheduler
   * @param {String} id - the containers id
   */
  done (id) {
    this._running.delete(id)
    this.instances.delete(id)
    this._checkWaits()
  }

  /**
   * returns a promise that resolves once all containers have reached the given
   * number of ticks
   * @param {interger} ticks - the number of ticks to wait
   * @param {string} id - optional id of the container that is waiting
   * @return {Promise}
   */
  wait (ticks, id) {
    this._running.delete(id)
    return new Promise((resolve, reject) => {
      binarySearchInsert(this._waits, comparator, {
        ticks: ticks,
        resolve: resolve,
        id: id
      })
      this._checkWaits()
    })
  }

  /**
   * returns the oldest container's ticks
   * @return {integer}
   */
  leastNumberOfTicks (exculde) {
    let ticks = 0
    for (const instance of this.instances) {
      ticks = instance[1].ticks
      if (instance[1].id !== exculde) {
        return ticks
      }
    }
    return ticks
  }

  // checks outstanding waits to see if they can be resolved
  async _checkWaits () {
    if (this._checkingWaits) {
      return
    } else {
      this._checkingWaits = true
      // wait to check waits untill all the instances are done loading
      await [...this._loadingInstances.values()]
    }
    // if there are no running containers
    if (!this.instances.size) {
      // clear any remanding waits
      this._waits.forEach(wait => wait.resolve())
      this._waits = []
      this._checkingWaits = false
    } else {
      // find the old container and see if to can resolve any of the waits
      while (this._waits[0]) {
        const wait = this._waits[0]
        const least = this.leastNumberOfTicks(wait.id)
        if (wait.ticks <= least) {
          this._waits.shift()
          wait.resolve()
          this._running.add(wait.id)
        } else {
          break
        }
      }

      if (!this._running.size && this._waits.length) {
        // if there are no containers running find the oldest wait and update
        // the oldest containers to it ticks
        const oldest = this._waits[0].ticks
        for (let instance of this.instances) {
          instance = instance[1]
          if (instance.ticks > oldest) {
            break
          } else {
            instance.ticks = oldest
            this._update(instance)
          }
        }
        this._checkingWaits = false
        return this._checkWaits()
      } else {
        this._checkingWaits = false
      }
    }
  }
}
