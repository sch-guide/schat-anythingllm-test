async function replacePreparedDocument(adapter) {
  // prepare owns cleanup of partial preparation if it throws. lock must acquire
  // ownership atomically or throw without taking ownership of another job's lock.
  const prepared = await adapter.prepare();
  let locked = false;
  let snapshot;
  let modified = false;
  let result;
  let failure;
  try {
    await adapter.lock();
    locked = true;
    snapshot = await adapter.snapshot();
    modified = true;
    await adapter.install(prepared);
    await adapter.retire();
    await adapter.verify();
    result = await adapter.archive();
  } catch (error) {
    failure = error;
    if (modified) {
      try {
        await adapter.restore(snapshot);
      } catch (restoreError) {
        // Keep both the durable lock and prepared data for recovery.
        throw new AggregateError([error, restoreError], "DOCUMENT_UPDATE_RECOVERY_REQUIRED");
      }
    }
  }
  // If releasing the lock fails, keep recovery data and report the blocked state.
  if (locked) {
    try {
      await adapter.unlock();
    } catch (unlockError) {
      throw new AggregateError([failure, unlockError].filter(Boolean), "DOCUMENT_UPDATE_UNLOCK_REQUIRED");
    }
  }
  try {
    await adapter.cleanup(prepared);
  } catch (cleanupError) {
    if (failure) throw new AggregateError([failure, cleanupError], "DOCUMENT_UPDATE_FAILED_CLEANUP_PENDING");
    return { ...result, warnings: [...(result?.warnings || []), "TEMPORARY_CLEANUP_PENDING"] };
  }
  if (failure) throw failure;
  return result;
}
module.exports = { replacePreparedDocument };
