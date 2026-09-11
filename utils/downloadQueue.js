// utils/downloadQueue.js
// Antrian download FIFO untuk perintah berat (!play / !tt).
// Hanya satu download yang berjalan bersamaan; sisanya menunggu
// sesuai urutan masuk. Mencegah lonjakan proses yt-dlp & penggunaan RAM.
let activeJob = null;   // label job yang sedang berjalan
const queue = [];       // antrian job menunggu

// Daftarkan job ke antrian. Kembalikan { position, promise }:
// - position: posisi antrean saat didaftarkan (1 = langsung jalan)
// - promise:  resolve/reject saat job selesai
function enqueue({ userJid, label, run }) {
  // Posisi = job yang sedang berjalan (jika ada) + job menunggu + dirinya sendiri
  const position = (activeJob ? 1 : 0) + queue.length + 1;

  let resolveJob, rejectJob;
  const promise = new Promise((resolve, reject) => {
    resolveJob = resolve;
    rejectJob = reject;
  });

  const job = {
    userJid,
    label: label || 'Download',
    run,
    resolve: resolveJob,
    reject: rejectJob,
  };
  queue.push(job);

  if (!activeJob) processNext();
  return { position, promise };
}

async function processNext() {
  const job = queue.shift();
  if (!job) {
    activeJob = null;
    return;
  }
  activeJob = job.label;
  try {
    const result = await job.run();
    job.resolve(result);
  } catch (err) {
    job.reject(err);
  } finally {
    activeJob = null;
    processNext();
  }
}

// Statistik untuk pesan antrian / pemantauan
function getQueueStats() {
  return {
    active: activeJob,
    waiting: queue.length,
    jobs: queue.map(j => j.label),
  };
}

module.exports = { enqueue, getQueueStats };
