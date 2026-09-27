function buildChatSearchQueries({
  originalQuestion = "",
  expandedBodyQuery = "",
} = {}) {
  return {
    bodySearchQuery: expandedBodyQuery,
    relatedImageSearchQuery: originalQuestion,
  };
}

module.exports = { buildChatSearchQueries };
