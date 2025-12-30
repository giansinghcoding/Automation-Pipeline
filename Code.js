// ===================================================
// Notion API helpers (NO secrets hardcoded)
// ===================================================
function getNotionHeaders_() {
  return {
    "Authorization": "Bearer " + getNotionToken_(),
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
  };
}

// ===================================================
// CREATE
// ===================================================
function createNotionPage() {
  const url = "https://api.notion.com/v1/pages";

  const payload = {
    parent: { database_id: getNotionDatabaseId_() },
    properties: {
      Name: {
        title: [
          {
            text: { content: "New page created" }
          }
        ]
      }
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    headers: getNotionHeaders_(),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  Logger.log(response.getContentText());
}

// ===================================================
// READ (list pages)
// ===================================================
function readDatabase() {
  const dbId = getNotionDatabaseId_();
  const url = `https://api.notion.com/v1/databases/${dbId}/query`;

  const options = {
    method: "post", // Notion uses POST for queries
    headers: getNotionHeaders_(),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const data = JSON.parse(response.getContentText());

  if (data.results) {
    data.results.forEach((page, i) => {
      const title = page.properties?.Name?.title?.[0]?.text?.content || "(No title)";
      Logger.log(`${i + 1}. ${title} | ID: ${page.id}`);
    });
  } else {
    Logger.log("Failed to read database: " + response.getContentText());
  }
}

// ===================================================
// READ (search by title keyword)
// ===================================================
function searchDatabaseByTitle(keyword) {
  const dbId = getNotionDatabaseId_();
  const url = `https://api.notion.com/v1/databases/${dbId}/query`;

  const options = {
    method: "post",
    headers: getNotionHeaders_(),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const data = JSON.parse(response.getContentText());

  if (!data.results) {
    Logger.log("Query failed: " + response.getContentText());
    return;
  }

  const matches = data.results.filter(page => {
    const title = page.properties?.Name?.title?.[0]?.text?.content || "";
    return title.toLowerCase().includes(String(keyword).toLowerCase());
  });

  if (matches.length === 0) {
    Logger.log(`No pages found with keyword: "${keyword}"`);
  } else {
    matches.forEach((page, i) => {
      const title = page.properties?.Name?.title?.[0]?.text?.content || "(No title)";
      Logger.log(`${i + 1}. ${title} | Page ID: ${page.id}`);
    });
  }
}

// ===================================================
// UPDATE
// ===================================================
function updatePage(pageId) {
  const url = `https://api.notion.com/v1/pages/${pageId}`;

  const payload = {
    properties: {
      Name: {
        title: [
          {
            text: { content: "Updated Title" }
          }
        ]
      }
    }
  };

  const options = {
    method: "patch",
    headers: getNotionHeaders_(),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  Logger.log("Update Response: " + response.getContentText());
}

// ===================================================
// DELETE (archive)
// ===================================================
function archivePage(pageId) {
  const url = `https://api.notion.com/v1/pages/${pageId}`;

  const payload = { archived: true };

  const options = {
    method: "patch",
    headers: getNotionHeaders_(),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  Logger.log("Archive Response: " + response.getContentText());
}

// ===================================================
// PDF → TXT → CSV pipeline (NO secrets hardcoded)
// ===================================================
function pdfToCSV_Transactions() {
  const API_KEY = getPdfCoApiKey_();
  const SOURCE_FOLDER_ID = getSourceFolderId_();
  const TXT_OUTPUT_FOLDER_ID = getTxtOutputFolderId_();
  const CSV_OUTPUT_FOLDER_ID = getCsvOutputFolderId_();

  const toTxtName = n => n.replace(/\.pdf$/i, ".txt");
  const toCsvName = n => n.replace(/\.pdf$/i, ".csv");

  const pdfFolder = DriveApp.getFolderById(SOURCE_FOLDER_ID);
  const files = pdfFolder.getFilesByType(MimeType.PDF);
  if (!files.hasNext()) return Logger.log("❌ No PDF files found.");

  const pdfFile = files.next();
  const pdfName = pdfFile.getName();
  Logger.log(`📄 Found PDF: ${pdfName}`);

  // === Upload to PDF.co ===
  const uploadRes = UrlFetchApp.fetch("https://api.pdf.co/v1/file/upload", {
    method: "post",
    headers: { "x-api-key": API_KEY },
    payload: { file: pdfFile.getBlob() }
  });

  const uploadJson = JSON.parse(uploadRes.getContentText());
  if (uploadJson.error) throw new Error(uploadJson.message);
  const uploadedUrl = uploadJson.url;
  Logger.log(`☁️ Uploaded to PDF.co: ${uploadedUrl}`);

  // === Convert to text with inline fallback ===
  const convertRes = UrlFetchApp.fetch("https://api.pdf.co/v1/pdf/convert/to/text", {
    method: "post",
    headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
    payload: JSON.stringify({ url: uploadedUrl, isOCR: true, OCRLanguage: "eng", inline: true })
  });

  const convertJson = JSON.parse(convertRes.getContentText());

  let txtRaw = "";
  if (convertJson.body) {
    txtRaw = convertJson.body;
    Logger.log("🧾 Text received inline from PDF.co");
  } else if (convertJson.url) {
    txtRaw = UrlFetchApp.fetch(convertJson.url).getContentText();
    Logger.log("🧾 Text file retrieved from PDF.co URL");
  } else {
    throw new Error(`PDF.co conversion failed: ${JSON.stringify(convertJson)}`);
  }

  DriveApp.getFolderById(TXT_OUTPUT_FOLDER_ID)
    .createFile(toTxtName(pdfName), txtRaw, MimeType.PLAIN_TEXT);

  const transactions = parseTransactionsFromTxt(txtRaw);
  Logger.log(`✅ Parsed ${transactions.length} transactions.`);

  const csvHeader = "Date,Description,Amount\n";
  const csvRows = transactions.map(
    t => `${t.date},"${t.description.replace(/"/g, '""')}",${t.amount}`
  );
  const csvData = csvHeader + csvRows.join("\n");

  const csvFile = DriveApp.getFolderById(CSV_OUTPUT_FOLDER_ID)
    .createFile(toCsvName(pdfName), csvData, MimeType.CSV);

  Logger.log(`📁 CSV saved: ${csvFile.getUrl()}`);
}

// ===================================================
// 🧠 Transaction Parser (your full logic, unchanged)
// ===================================================
function parseTransactionsFromTxt(rawText) {
  const lines = rawText
    .replace(/\r/g, "")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  const monthRe     = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b/;
  const eTransferRe = /(E-TRANSFER)/i;
  const moneyReAll  = /\d{1,3}(?:,\d{3})*(?:\.\d{2})/g;
  const fxRateRe    = /\b[A-Z]{3}\s*@\s*\d+(?:\.\d{2,6})?\b/i;
  const ignoreRe    = /(Opening balance|Balance forward|Closing balance|continued|^CIBC\b|^Account\b)/i;
  const posKw       = /(E-TRANSFER|REVERSAL|REFUND|CREDIT|DEPOSIT|PAYROLL|CORRECTION|DISCOUNT)/i;
  const negKw       = /(RETAIL|WITHDRAWAL|PURCHASE|TRANSFER|FEE|VISA|DEBIT|PAYMENT)/i;

  const out = [];
  const consumed = new Set();
  let currentDate = "";

  const pickAmount = line => {
    const matches = [...(line.matchAll(moneyReAll) || [])].map(m => m[0]);
    return matches.length ? matches[0].replace(/,/g, "") : null;
  };

  const detectSignBySpacing = (line, amount) => {
    const idx = line.indexOf(amount);
    if (idx === -1) return 0;
    const spaces = (line.slice(0, idx).match(/ +$/) || [""])[0].length;
    return spaces >= 3 ? +1 : -1;
  };

  const isNameLine = s =>
    /^[A-Za-z][A-Za-z\s'.-]+$/.test(s) &&
    !monthRe.test(s) && !eTransferRe.test(s) &&
    !moneyReAll.test(s) && !fxRateRe.test(s);

  let startIdx = lines.findIndex(l => /Transaction details/i.test(l));
  if (startIdx === -1) startIdx = 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (ignoreRe.test(line) || fxRateRe.test(line)) continue;

    const dm = line.match(monthRe);
    if (dm) currentDate = dm[0];

    // === E-Transfers ===
    if (eTransferRe.test(line)) {
      const idMatch = line.match(/\d{9,14}/); // extract long ID
      let amount = null, amountLine = line;

      // find amount within next 2 lines if not on same line
      for (let j = i; j <= i + 2 && j < lines.length; j++) {
        if (fxRateRe.test(lines[j])) continue;
        const a = pickAmount(lines[j]);
        if (a) { amount = a; amountLine = lines[j]; break; }
      }
      if (!amount) continue;

      // collect name lines around it
      const nameParts = [];
      for (let off = -1; off <= 2; off++) {
        const idx = i + off;
        if (idx < 0 || idx >= lines.length || consumed.has(idx)) continue;
        const look = lines[idx];
        if (fxRateRe.test(look) || ignoreRe.test(look)) continue;

        if (off !== 0 && isNameLine(look)) {
          nameParts.push(look);
          consumed.add(idx);
        }
      }

      const name = nameParts.join(" ").replace(/\s{2,}/g, " ").trim();
      let val = Math.abs(parseFloat(amount));

      if (idMatch) {
        const first = idMatch[0].charAt(0);
        if (first === "0") val = +Math.abs(val);
        else if (first === "1") val = -Math.abs(val);
      } else {
        let sign = detectSignBySpacing(amountLine, amount);
        if (sign === 0) sign = +1;
        val = sign >= 0 ? +val : -val;
      }

      out.push({
        date: currentDate,
        description: `E-TRANSFER ${idMatch ? idMatch[0] : ""} ${name}`.trim(),
        amount: (val >= 0 ? "+" : "-") + Math.abs(val).toFixed(2)
      });

      continue;
    }

    // === Other Transactions ===
    const amount = pickAmount(line);
    if (!amount || !currentDate) continue;

    const amtIdx = line.indexOf(amount);
    const leftSide = amtIdx >= 0 ? line.slice(0, amtIdx) : line;

    let cleanLeft = leftSide
      .replace(new RegExp("\\b" + currentDate + "\\b", "g"), "")
      .replace(monthRe, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    cleanLeft = cleanLeft.replace(/[\u00A0\u2007\u202F\t]/g, " ");

    const lastLetterIndex = cleanLeft.search(/[A-Za-z][^A-Za-z]*$/);
    const amountIndex = line.indexOf(amount);
    if (amountIndex > -1 && lastLetterIndex > -1) {
      const distance = amountIndex - (lastLetterIndex + 1);
      if (distance <= 2) continue;
    }

    if (!cleanLeft || ignoreRe.test(cleanLeft) || fxRateRe.test(cleanLeft)) continue;

    let val = Math.abs(parseFloat(amount));

    if (/\b(discount|reversal|correction)\b/i.test(cleanLeft)) {
      val = +Math.abs(val);
    } else if (negKw.test(cleanLeft)) {
      val = -val;
    } else if (posKw.test(cleanLeft)) {
      val = +val;
    } else {
      const s = detectSignBySpacing(line, amount);
      val = s >= 0 ? +val : -val;
    }

    out.push({
      date: currentDate,
      description: cleanLeft,
      amount: (val >= 0 ? "+" : "-") + Math.abs(val).toFixed(2)
    });
  }

  return out;
}

