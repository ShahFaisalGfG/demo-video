// testreel reports a failed cursor, frame, speed, or format pass only as a stderr
// warning and returns the unprocessed capture. These helpers collect those
// warnings so callers can refuse the output instead of shipping a video without
// its presentation treatment.

const FAILURE = /warning: (post-processing|format conversion) failed: (.+)/;

/** Start collecting testreel failure warnings from stderr; call stop() to restore stderr and read them. */
export function watchTestreelFailures() {
  const failures = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...args) => {
    const failed = (typeof chunk === 'string' ? chunk : chunk.toString()).match(FAILURE);
    if (failed) failures.push(`${failed[1]}: ${failed[2].split('\n')[0].slice(0, 300)}`);
    return write(chunk, ...args);
  };
  return {
    failures,
    stop() {
      process.stderr.write = write;
      return failures;
    },
  };
}
