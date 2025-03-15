const multer = require("multer");
const path = require("path");
const fs = require("fs");
// const Video = require("../models/video");
const Video = require("../models/Video");
const ffmpeg = require("fluent-ffmpeg");

// Ensure the videos directory exists
const uploadPath = process.env.PATH_VIDEOS;
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["video/mp4", "video/quicktime"]; // quicktime for .mov
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(
        new Error("Invalid file type. Only .mp4 and .mov are allowed.")
      );
    }
    cb(null, true);
  },
});

const deleteVideo = async (videoId) => {
  try {
    const video = await Video.findByPk(videoId);
    if (!video) {
      return { success: false, error: "Video not found" };
    }

    await video.destroy();
    return { success: true, message: "Video deleted successfully" };
  } catch (error) {
    console.error("Error deleting video:", error);
    return { success: false, error: error.message };
  }
};

// -- Version 2: accepts single timestamp

async function createVideoMontageSingleClip(videoFilePathAndName, timestamp) {
  return new Promise((resolve, reject) => {
    console.log("🔹 Starting createVideoMontageSingleClip...");
    console.log(`🎥 Source Video: ${videoFilePathAndName}`);
    console.log(`⏳ Target Timestamp: ${timestamp} seconds`);

    if (!fs.existsSync(videoFilePathAndName)) {
      console.error("❌ Source video file not found.");
      return reject(new Error("Source video file not found."));
    }

    if (typeof timestamp !== "number" || timestamp < 0) {
      console.error("❌ Invalid timestamp provided.");
      return reject(new Error("Invalid timestamp."));
    }

    // 🔹 Define start and end time
    const clipStart = Math.max(timestamp - 1.5, 0); // Ensure we don’t start before 0
    const clipDuration = 3.0; // 1.5 sec before + 1.5 sec after

    console.log(`🎬 Clip Start: ${clipStart} seconds`);
    console.log(`🎬 Clip Duration: ${clipDuration} seconds`);

    // 🔹 Define output filename
    const outputFileName = `clip_${Date.now()}.mp4`;
    const outputFilePath = path.join(process.env.PATH_VIDEOS, outputFileName);

    console.log(`📁 Output File: ${outputFilePath}`);

    // 🔹 Execute FFmpeg command
    ffmpeg(videoFilePathAndName)
      .setStartTime(clipStart) // Start at clipStart
      .setDuration(clipDuration) // Set clip duration
      .output(outputFilePath)
      .on("start", (cmd) => console.log(`🚀 FFmpeg Command: ${cmd}`))
      .on("end", () => {
        console.log(`✅ Montage created successfully: ${outputFilePath}`);
        resolve(outputFilePath);
      })
      .on("error", (err) => {
        console.error("❌ FFmpeg Error:", err);
        reject(err);
      })
      .run();
  });
}

// -- Version 1: accepts array of timestamps, creates video but it seems to be just a copy - not a montage
// async function createVideoMontage(videoFilePathAndName, timestampArray) {
//   return new Promise((resolve, reject) => {
//     if (!fs.existsSync(videoFilePathAndName)) {
//       return reject(new Error("Source video file not found."));
//     }
//     console.log(
//       `- in createVideoMontage: videoFilePathAndName: ${videoFilePathAndName}`
//     );
//     console.log(`- in createVideoMontage: timestampArray: ${timestampArray}`);

//     if (!timestampArray || timestampArray.length === 0) {
//       return reject(new Error("No timestamps provided."));
//     }

//     // 🔹 Sort timestamps and merge overlapping clips
//     timestampArray.sort((a, b) => a - b);
//     let clips = [];

//     let start = timestampArray[0] - 1.5; // Start 1.5 sec before first timestamp
//     let end = timestampArray[0] + 1.5; // End 1.5 sec after first timestamp

//     for (let i = 1; i < timestampArray.length; i++) {
//       let newStart = timestampArray[i] - 1.5;
//       let newEnd = timestampArray[i] + 1.5;

//       if (newStart <= end) {
//         // Merge overlapping timestamps
//         end = newEnd;
//       } else {
//         clips.push({ start, end });
//         start = newStart;
//         end = newEnd;
//       }
//     }
//     clips.push({ start, end });

//     // 🔹 Generate FFmpeg commands for each clip
//     let ffmpegCommand = ffmpeg(videoFilePathAndName);
//     let filterComplex = "";
//     let outputFileName = `montage_${Date.now()}.mp4`;
//     let outputFilePath = path.join(process.env.PATH_VIDEOS, outputFileName);

//     clips.forEach((clip, index) => {
//       console.log(
//         `- in createVideoMontage: clip.start: ${clip.start} - ${clip.end}`
//       );
//       ffmpegCommand = ffmpegCommand.input(videoFilePathAndName).inputOptions([
//         `-ss ${Math.max(clip.start, 0)}`, // Ensure start time is not negative
//         `-t ${clip.end - clip.start}`, // Duration
//       ]);
//       filterComplex += `[${index}:v:0][${index}:a:0]`;
//     });

//     // 🔹 Process the video clips and generate the montage
//     ffmpegCommand
//       .on("end", () => resolve(outputFilePath))
//       .on("error", (err) => reject(err))
//       .mergeToFile(outputFilePath, path.dirname(outputFilePath));
//   });
// }
// -- Version 3: accepts array of timestamps, creates video but it creates a video file from the start to end of last timestamp including all in between.
async function createVideoMontageClipFromTwoTimestamps(
  videoFilePathAndName,
  timestampArray
) {
  return new Promise((resolve, reject) => {
    console.log("🔹 Starting createVideoMontageClipFromTwoTimestamps...");
    console.log(`🎥 Source Video: ${videoFilePathAndName}`);
    console.log(`⏳ Received Timestamps: ${timestampArray}`);

    if (!fs.existsSync(videoFilePathAndName)) {
      console.error("❌ Source video file not found.");
      return reject(new Error("Source video file not found."));
    }

    if (
      !Array.isArray(timestampArray) ||
      timestampArray.length !== 2 ||
      timestampArray.some((ts) => typeof ts !== "number" || ts < 0)
    ) {
      console.error("❌ Invalid timestamps provided.");
      return reject(new Error("Invalid timestamps."));
    }

    // 🔹 Sort timestamps to ensure correct start and end time
    const [startTimestamp, endTimestamp] = timestampArray.sort((a, b) => a - b);

    // 🔹 Define start time and duration
    const clipStart = Math.max(startTimestamp - 1.5, 0); // Ensure we don’t start before 0
    const clipEnd = endTimestamp + 1.5; // Extend 1.5s after the last timestamp
    const clipDuration = clipEnd - clipStart;

    console.log(`🎬 Clip Start: ${clipStart} seconds`);
    console.log(`🎬 Clip End: ${clipEnd} seconds`);
    console.log(`🎬 Clip Duration: ${clipDuration} seconds`);

    // 🔹 Define output filename
    const outputFileName = `clip_${Date.now()}.mp4`;
    const outputFilePath = path.join(process.env.PATH_VIDEOS, outputFileName);

    console.log(`📁 Output File: ${outputFilePath}`);

    // 🔹 Execute FFmpeg command
    ffmpeg(videoFilePathAndName)
      .setStartTime(clipStart) // Start at calculated start time
      .setDuration(clipDuration) // Set calculated duration
      .output(outputFilePath)
      .on("start", (cmd) => console.log(`🚀 FFmpeg Command: ${cmd}`))
      .on("end", () => {
        console.log(`✅ Montage created successfully: ${outputFilePath}`);
        resolve(outputFilePath);
      })
      .on("error", (err) => {
        console.error("❌ FFmpeg Error:", err);
        reject(err);
      })
      .run();
  });
}

// -- Verison 4: creates individual clips the merges them together
async function createVideoMontage04(videoFilePathAndName, timestampArray) {
  console.log("🔹 Starting createVideoMontage04...");
  console.log(`🎥 Source Video: ${videoFilePathAndName}`);
  console.log(`⏳ Received Timestamps: ${timestampArray}`);

  if (!fs.existsSync(videoFilePathAndName)) {
    console.error("❌ Source video file not found.");
    throw new Error("Source video file not found.");
  }

  if (!Array.isArray(timestampArray) || timestampArray.length === 0) {
    console.error("❌ No timestamps provided.");
    throw new Error("No timestamps provided.");
  }

  const clipsPath = process.env.PATH_VIDEOS_MONTAGE_CLIPS;
  const outputPath = process.env.PATH_VIDEOS_MONTAGE_COMPLETE;
  if (!clipsPath || !outputPath) {
    console.error("❌ Missing required environment variables.");
    throw new Error("Missing required environment variables.");
  }

  // Ensure clips and output folders exist
  if (!fs.existsSync(clipsPath)) fs.mkdirSync(clipsPath, { recursive: true });
  if (!fs.existsSync(outputPath)) fs.mkdirSync(outputPath, { recursive: true });

  let clipFilePaths = [];

  // 🔹 Step 1: Create individual clips
  for (let i = 0; i < timestampArray.length; i++) {
    const timestamp = timestampArray[i];
    const clipStart = Math.max(timestamp - 1.5, 0);
    const clipDuration = 3.0; // 1.5s before + 1.5s after
    const clipFilePath = path.join(clipsPath, `${i + 1}.mp4`);

    console.log(
      `🎬 Creating clip ${
        i + 1
      }: Start ${clipStart}s, Duration ${clipDuration}s -> ${clipFilePath}`
    );

    await new Promise((resolve, reject) => {
      ffmpeg(videoFilePathAndName)
        .setStartTime(clipStart)
        .setDuration(clipDuration)
        .output(clipFilePath)
        .on("start", (cmd) => console.log(`🚀 FFmpeg Command: ${cmd}`))
        .on("end", () => {
          console.log(`✅ Clip ${i + 1} created: ${clipFilePath}`);
          clipFilePaths.push(clipFilePath);
          resolve();
        })
        .on("error", (err) => {
          console.error(`❌ Error creating clip ${i + 1}:`, err);
          reject(err);
        })
        .run();
    });
  }

  // 🔹 Step 2: Combine all clips into one video
  const finalOutputPath = path.join(outputPath, `montage_${Date.now()}.mp4`);
  const fileListPath = path.join(clipsPath, "file_list.txt");

  // Generate file list for FFmpeg
  fs.writeFileSync(
    fileListPath,
    clipFilePaths.map((file) => `file '${file}'`).join("\n")
  );

  console.log("📃 File list for merging:");
  console.log(fs.readFileSync(fileListPath, "utf8"));

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(fileListPath)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c copy"])
      .output(finalOutputPath)
      .on("start", (cmd) =>
        console.log(`🚀 Merging clips with FFmpeg Command: ${cmd}`)
      )
      .on("end", () => {
        console.log(`✅ Montage created successfully: ${finalOutputPath}`);
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ Error merging clips:", err);
        reject(err);
      })
      .run();
  });

  return finalOutputPath;
}

module.exports = {
  upload,
  deleteVideo,
  createVideoMontageSingleClip,
  createVideoMontageClipFromTwoTimestamps,
  createVideoMontage04,
};
