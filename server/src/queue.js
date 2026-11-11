/**
 * A fair, concurrency-limited work queue.
 *
 * Each client (IP) gets its own FIFO; the dispatcher round-robins between
 * clients, so one person uploading 50 videos can't make everyone else wait
 * behind them. Two lanes (light/heavy) keep quick jobs flowing while long
 * video encodes run.
 */
export class FairLane {
  constructor(name, concurrency) {
    this.name = name;
    this.concurrency = concurrency;
    this.running = 0;
    this.queues = new Map(); // clientId -> [{ job, task }]
    this.rr = []; // round-robin order of clientIds with waiting work
    this.completed = 0;
    this.avgMs = 0;
  }

  get waiting() {
    let n = 0;
    for (const q of this.queues.values()) n += q.length;
    return n;
  }

  push(job, task) {
    const id = job.clientId;
    if (!this.queues.has(id)) {
      this.queues.set(id, []);
      this.rr.push(id);
    }
    this.queues.get(id).push({ job, task });
    this.pump();
  }

  remove(jobId) {
    for (const [cid, q] of this.queues) {
      const i = q.findIndex((e) => e.job.id === jobId);
      if (i >= 0) {
        q.splice(i, 1);
        if (!q.length) this.dropClient(cid);
        return true;
      }
    }
    return false;
  }

  dropClient(cid) {
    this.queues.delete(cid);
    this.rr = this.rr.filter((c) => c !== cid);
  }

  /** Approximate number of jobs that will start before this one. */
  position(job) {
    const q = this.queues.get(job.clientId);
    if (!q) return 0;
    const k = q.findIndex((e) => e.job.id === job.id);
    if (k < 0) return 0;
    let ahead = k;
    for (const [cid, other] of this.queues) if (cid !== job.clientId) ahead += Math.min(other.length, k + 1);
    return ahead + 1;
  }

  pump() {
    while (this.running < this.concurrency && this.rr.length) {
      const cid = this.rr.shift();
      const q = this.queues.get(cid);
      const entry = q.shift();
      if (q.length) this.rr.push(cid);
      else this.queues.delete(cid);
      this.start(entry);
    }
  }

  async start({ job, task }) {
    this.running++;
    const t0 = Date.now();
    try {
      await task();
    } finally {
      this.running--;
      this.completed++;
      const ms = Date.now() - t0;
      this.avgMs = this.avgMs ? this.avgMs * 0.9 + ms * 0.1 : ms;
      setImmediate(() => this.pump());
    }
  }

  stats() {
    return { running: this.running, waiting: this.waiting, concurrency: this.concurrency, completed: this.completed, avgSeconds: Math.round(this.avgMs / 100) / 10 };
  }
}
