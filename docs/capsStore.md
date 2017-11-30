<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

### Table of Contents

-   [constructor](#constructor)
-   [store](#store)
-   [load](#load)
-   [delete](#delete)

## constructor

[capsStore.js:6-8](https://github.com/primea/js-primea-hypervisor/blob/46c11229b2dac84739660d8242a0eaa65697f8bc/capsStore.js#L6-L8 "Source code on GitHub")

The caps store, persistantly stores an actors capabilites.

**Parameters**

-   `storedCaps` **[Object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)** 

## store

[capsStore.js:15-18](https://github.com/primea/js-primea-hypervisor/blob/46c11229b2dac84739660d8242a0eaa65697f8bc/capsStore.js#L15-L18 "Source code on GitHub")

Stores a cap at a given key

**Parameters**

-   `key` **[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)** 
-   `cap` **[Object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)** 

## load

[capsStore.js:25-28](https://github.com/primea/js-primea-hypervisor/blob/46c11229b2dac84739660d8242a0eaa65697f8bc/capsStore.js#L25-L28 "Source code on GitHub")

gets a cap given its key

**Parameters**

-   `key` **[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)** 

Returns **[Object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)** 

## delete

[capsStore.js:34-36](https://github.com/primea/js-primea-hypervisor/blob/46c11229b2dac84739660d8242a0eaa65697f8bc/capsStore.js#L34-L36 "Source code on GitHub")

delete cap given its key

**Parameters**

-   `key` **[string](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)** 