// A thread keeps the server's default name ("Thread") until its first message
// renames it, so an unnamed thread is an empty "new conversation" and is not
// listed. Threads being deleted stay visible until the removal animation ends.
export const EMPTY_THREAD_NAME = "Thread";

export function listedThreads(threads = []) {
  return threads.filter(
    (thread) => thread?.deleted === true || thread?.name !== EMPTY_THREAD_NAME
  );
}
