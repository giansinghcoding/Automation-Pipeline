/**
 * Secrets & configuration accessors
 * Values must be set in:
 * Apps Script → Project Settings → Script Properties
 */

// ========= NOTION =========
function getNotionToken_() {
  return getRequiredProp_("NOTION_TOKEN");
}

function getNotionDatabaseId_() {
  return getRequiredProp_("NOTION_DATABASE_ID");
}

// ========= PDF.CO =========
function getPdfCoApiKey_() {
  return getRequiredProp_("PDFCO_API_KEY");
}

// ========= DRIVE FOLDERS =========
function getSourceFolderId_() {
  return getRequiredProp_("SOURCE_FOLDER_ID");
}

function getTxtOutputFolderId_() {
  return getRequiredProp_("TXT_OUTPUT_FOLDER_ID");
}

function getCsvOutputFolderId_() {
  return getRequiredProp_("CSV_OUTPUT_FOLDER_ID");
}

// ========= INTERNAL HELPER =========
function getRequiredProp_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error(
      `Missing Script Property: ${key}. Add it in Project Settings → Script Properties.`
    );
  }
  return value.trim();
}


