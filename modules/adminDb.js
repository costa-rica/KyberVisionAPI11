const csvParser = require("csv-parser");
const fs = require("fs");
const path = require("path");
const sequelize = require("../models/_connection"); // Import Sequelize instance

// Import models directly
const User = require("../models/User");
const Video = require("../models/Video");
const Action = require("../models/Action");
const CompetitionContract = require("../models/CompetitionContract");
const Complex = require("../models/Complex");
const GroupContract = require("../models/GroupContract");
const League = require("../models/League");
const Match = require("../models/Match");
const OpponentServeTimestamp = require("../models/OpponentServeTimestamp");
const Player = require("../models/Player");
const PlayerContract = require("../models/PlayerContract");
const Point = require("../models/Point");
const Script = require("../models/Script");
const SyncContract = require("../models/SyncContract");
const Team = require("../models/Team");

const { promisify } = require("util");
const archiver = require("archiver");
const { Parser } = require("json2csv");
const mkdirAsync = promisify(fs.mkdir);
const writeFileAsync = promisify(fs.writeFile);

const models = {
  User,
  Video,
  Action,
  CompetitionContract,
  Complex,
  GroupContract,
  League,
  Match,
  OpponentServeTimestamp,
  Player,
  PlayerContract,
  Point,
  Script,
  SyncContract,
  Team,
};

async function readAndAppendDbTables(backupFolderPath) {
  console.log(`Processing CSV files from: ${backupFolderPath}`);
  console.log(`Sequelize instance: ${sequelize}`);
  let currentTable = null;
  try {
    // Read all CSV files from the backup directory
    const csvFiles = await fs.promises.readdir(backupFolderPath);
    let totalRecordsImported = 0;

    // Separate CSV files into four append batches
    const appendBatch1 = [];

    csvFiles.forEach((file) => {
      if (!file.endsWith(".csv")) return; // Skip non-CSV files
      appendBatch1.push(file);
    });

    console.log(`Append Batch 1 (First): ${appendBatch1}`);
    // console.log(
    //   `Append Batch 2 (Second - Contract, Match, Video): ${appendBatch2}`
    // );
    // console.log(`Append Batch 3 (Third - Action): ${appendBatch3}`);
    // console.log(`Append Batch 4 (Last - SyncContract): ${appendBatch4}`);

    // Helper function to process CSV files
    async function processCSVFiles(files) {
      let recordsImported = 0;

      for (const file of files) {
        const tableName = file.replace(".csv", "");
        if (!models[tableName]) {
          console.log(`Skipping ${file}, no matching table found.`);
          continue;
        }

        console.log(`Importing data into table: ${tableName}`);
        currentTable = tableName;
        const filePath = path.join(backupFolderPath, file);
        const records = [];

        // Read CSV file
        await new Promise((resolve, reject) => {
          fs.createReadStream(filePath)
            .pipe(csvParser())
            .on("data", (row) => records.push(row))
            .on("end", resolve)
            .on("error", reject);
        });

        if (records.length > 0) {
          await models[tableName].bulkCreate(records, {
            ignoreDuplicates: true,
          });
          recordsImported += records.length;
          console.log(`Imported ${records.length} records into ${tableName}`);
        } else {
          console.log(`No records found in ${file}`);
        }
      }

      return recordsImported;
    }

    // 🔹 Disable foreign key constraints before importing
    // ↪This allows us to append when necessary foreign keys are not yet populated.
    console.log("Disabling foreign key constraints...");
    await sequelize.query("PRAGMA foreign_keys = OFF;");

    // Process the batches in order
    totalRecordsImported += await processCSVFiles(appendBatch1); // First batch

    // 🔹 Re-enable foreign key constraints after importing
    console.log("Re-enabling foreign key constraints...");
    await sequelize.query("PRAGMA foreign_keys = ON;");

    return {
      success: true,
      message: `Successfully imported ${totalRecordsImported} records.`,
    };
  } catch (error) {
    console.error("Error processing CSV files:", error);

    // Ensure foreign key constraints are re-enabled even if an error occurs
    await sequelize.query("PRAGMA foreign_keys = ON;");

    return {
      success: false,
      error: error.message,
      failedOnTableName: currentTable,
    };
  }
}

async function createDatabaseBackupZipFile() {
  try {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-T:.Z]/g, "")
      .slice(0, 15);

    const backupDir = path.join(
      process.env.PATH_DB_BACKUPS,
      `db_backup_${timestamp}`
    );
    await mkdirAsync(backupDir, { recursive: true });

    let hasData = false;

    for (const tableName in models) {
      if (models.hasOwnProperty(tableName)) {
        const records = await models[tableName].findAll({ raw: true });
        if (records.length === 0) continue;

        const json2csvParser = new Parser();
        const csvData = json2csvParser.parse(records);

        const filePath = path.join(backupDir, `${tableName}.csv`);
        await writeFileAsync(filePath, csvData);
        hasData = true;
      }
    }

    if (!hasData) {
      await fs.promises.rmdir(backupDir, { recursive: true });
      throw new Error("No data found in any tables. Backup skipped.");
    }

    const zipFileName = `db_backup_${timestamp}.zip`;
    const zipFilePath = path.join(process.env.PATH_DB_BACKUPS, zipFileName);
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      output.on("close", () => resolve(zipFilePath));
      archive.on("error", reject);
      archive.pipe(output);
      archive.directory(backupDir, false);
      archive.finalize().then(() => {
        fs.promises.rmdir(backupDir, { recursive: true });
      });
    });
  } catch (error) {
    console.error("Error creating database backup:", error);
    throw error;
  }
}

module.exports = {
  readAndAppendDbTables,
  createDatabaseBackupZipFile,
};
