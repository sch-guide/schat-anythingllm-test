const { createAnswerCache } = require('./answerCache');

// Admin routes, chat and document mutations must share the same process cache.
const cache = createAnswerCache();
module.exports = { cache, beginMutation: (...args) => cache.beginMutation(...args) };
