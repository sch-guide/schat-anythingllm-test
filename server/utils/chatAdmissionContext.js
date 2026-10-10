const { AsyncLocalStorage } = require("node:async_hooks");
const context = new AsyncLocalStorage();
module.exports = {
  withAdmissionSignal: (signal, work) => context.run(signal, work),
  currentAdmissionSignal: () => context.getStore(),
};
