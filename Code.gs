"use strict";

/* =========================================================
   넘버원 김포B 공비 - 데이터점검·자동백업 감시 통합본

   데이터 시트
   A열: 지역 / B열: 아파트 / C열: 공동 / D열: 동 / E열: 라인 / F열: 비번

   - 매일 새벽 6시경 자동 백업
   - 최근 백업 5개 유지
   - 최근 수정기록만 직접 읽어 로딩 속도 향상
   - 비밀번호 숫자 자연 정렬
   - 비밀번호 추가·수정·삭제 및 되돌리기
   - 관리자 데이터 오류 점검
   - 자동백업 성공·실패·지연 감시
   - 관리자 비밀번호 우선순위·호수 정렬·중복 제거
========================================================= */

const CONFIG = Object.freeze({
    SHEET_NAME: "",
    HISTORY_SHEET_NAME: "변경이력",
    USAGE_SHEET_NAME: "앱사용현황",
    USAGE_ACTIVE_MINUTES: 5,
    USAGE_RETENTION_DAYS: 31,
    BACKUP_PREFIX: "백업_",
    BACKUP_KEEP_COUNT: 5,
    AUTO_BACKUP_HANDLER: "dailyAutomaticBackup",
    AUTO_BACKUP_HOUR: 6,
    AUTO_BACKUP_STALE_HOURS: 30,
    AUTO_BACKUP_SETUP_AT_PROPERTY: "GIMPO_B_AUTO_BACKUP_SETUP_AT_V1",
    AUTO_BACKUP_LAST_SUCCESS_PROPERTY: "GIMPO_B_AUTO_BACKUP_LAST_SUCCESS_V1",
    AUTO_BACKUP_LAST_FAILURE_PROPERTY: "GIMPO_B_AUTO_BACKUP_LAST_FAILURE_V1",
    AUTO_BACKUP_LAST_FAILURE_MESSAGE_PROPERTY: "GIMPO_B_AUTO_BACKUP_LAST_FAILURE_MESSAGE_V1",
    DATA_QUALITY_CACHE_SECONDS: 5 * 60,
    DATA_QUALITY_REPORT_VERSION: "20260715-2",
    DATA_QUALITY_DETAIL_LIMIT: 20,
    TIME_ZONE: "Asia/Seoul",
    DATA_VERSION_PROPERTY: "GIMPO_B_DATA_VERSION_V2",
    ADMIN_PIN_PROPERTY: "GIMPO_B_ADMIN_PIN",
    ADMIN_SESSION_SECONDS: 30 * 60,
    ADMIN_MAX_FAILURES: 5,
    ADMIN_LOCK_SECONDS: 10 * 60,
    HEADER_ROW: 1,
    REGION_COLUMN: 1,
    APARTMENT_COLUMN: 2,
    COMMON_PASSWORD_COLUMN: 3,
    DONG_COLUMN: 4,
    LINE_COLUMN: 5,
    PASSWORD_COLUMN: 6,
    PASSWORD_SEPARATOR: " / ",
    LOCK_TIMEOUT: 10000,
    HISTORY_LIMIT: 100
});

const HISTORY_HEADERS = Object.freeze([
    "변경ID", "작업ID", "변경시간", "지역", "아파트", "동", "라인", "변경종류",
    "변경전", "변경후", "되돌림여부", "되돌림시간", "대상행", "원본변경ID",
    "되돌림작업ID", "복원데이터"
]);

const HC = Object.freeze({
    HISTORY_ID: 1,
    OPERATION_ID: 2,
    CHANGED_AT: 3,
    REGION: 4,
    APARTMENT: 5,
    DONG: 6,
    LINE: 7,
    CHANGE_TYPE: 8,
    BEFORE_VALUE: 9,
    AFTER_VALUE: 10,
    REVERTED: 11,
    REVERTED_AT: 12,
    TARGET_ROW: 13,
    ORIGINAL_HISTORY_ID: 14,
    REVERT_OPERATION_ID: 15,
    RESTORE_DATA: 16
});

function doGet(e) {
    try {
        const parameters = e && e.parameter ? e.parameter : {};
        const action = cleanText(parameters.action) || "getData";

        if (action === "getData") return jsonResponse({ success: true, data: getData(), version: getDataVersion() });
        if (action === "getDataVersion") return jsonResponse({ success: true, version: getDataVersion() });
        if (action === "getDataIntegrity") return jsonResponse({ success: true, data: getDataIntegrity() });
        if (action === "getAdminDashboard") {
            requireAdminToken(parameters.adminToken);
            return jsonResponse({ success: true, data: getAdminDashboard() });
        }
        if (action === "compareBackup") {
            requireAdminToken(parameters.adminToken);
            return jsonResponse({ success: true, data: compareBackup(parameters.backupName) });
        }
        if (action === "getChangeHistory") {
            return jsonResponse({ success: true, data: getChangeHistory(parameters.limit) });
        }

        return jsonResponse({ success: false, message: `지원하지 않는 GET 작업입니다: ${action}` });
    } catch (error) {
        console.error(error);
        return errorResponse(error);
    }
}

function doPost(e) {
    try {
        const requestData = parsePostData(e);
        const action = cleanText(requestData.action);
        if (!action) throw new Error("요청 작업(action)이 없습니다.");

        switch (action) {
            case "numberOneVerifyAccessPin": return jsonResponse(numberOneVerifyAccessPin(requestData));
            case "numberOneRegister": return jsonResponse(numberOneRegister(requestData));
            case "numberOneAccountLogin": return jsonResponse(numberOneAccountLogin(requestData));
            case "numberOneLogout": return jsonResponse(numberOneLogout(requestData));
            case "numberOneGetWeek": return jsonResponse(numberOneGetWeek(requestData));
            case "numberOneSaveDay": return jsonResponse(numberOneSaveDay(requestData));
            case "numberOneDeleteDay": return jsonResponse(numberOneDeleteDay(requestData));
            case "adminLogin": return jsonResponse(adminLogin(requestData));
            case "recordUsage": return jsonResponse(recordUsage(requestData));
            case "updateCommonPassword": return jsonResponse(updateCommonPassword(requestData));
            case "addPassword": return jsonResponse(addPassword(requestData));
            case "updatePassword": return jsonResponse(updatePassword(requestData));
            case "deletePassword": return jsonResponse(deletePassword(requestData));
            case "undoChange": return jsonResponse(undoChange(requestData));
            case "createBackup": requireAdminToken(requestData.adminToken); return jsonResponse(createBackup(requestData));
            case "restoreBackup": requireAdminToken(requestData.adminToken); return jsonResponse(restoreBackup(requestData));
            case "setupAutoBackup": requireAdminToken(requestData.adminToken); return jsonResponse(setupDailyBackupTrigger());
            case "cleanupPasswords": requireAdminToken(requestData.adminToken); return jsonResponse(cleanupPasswords(requestData));
            case "getData": return jsonResponse({ success: true, data: getData(), version: getDataVersion() });
            case "getDataVersion": return jsonResponse({ success: true, version: getDataVersion() });
            case "getDataIntegrity": return jsonResponse({ success: true, data: getDataIntegrity() });
            case "getChangeHistory": return jsonResponse({ success: true, data: getChangeHistory(requestData.limit) });
            case "getAdminDashboard": requireAdminToken(requestData.adminToken); return jsonResponse({ success: true, data: getAdminDashboard() });
            case "compareBackup": requireAdminToken(requestData.adminToken); return jsonResponse({ success: true, data: compareBackup(requestData.backupName) });
            default: throw new Error(`지원하지 않는 작업입니다: ${action}`);
        }
    } catch (error) {
        console.error(error);
        return errorResponse(error);
    }
}

function adminLogin(data) {
    const pin = cleanText(data && data.pin);
    const clientId = cleanText(data && data.clientId) || "unknown";
    if (!/^\d{4}$/.test(pin)) throw new Error("관리자 PIN은 숫자 4자리여야 합니다.");

    const cache = CacheService.getScriptCache();
    const clientKey = sha256Hex(clientId).slice(0, 32);
    const failureKey = `ADMIN_FAIL_${clientKey}`;
    const lockKey = `ADMIN_LOCK_${clientKey}`;

    if (cache.get(lockKey)) throw new Error("관리자 PIN 오류가 여러 번 발생했습니다. 10분 후 다시 시도해주세요.");

    const configuredPin = cleanText(PropertiesService.getScriptProperties().getProperty(CONFIG.ADMIN_PIN_PROPERTY));
    if (!/^\d{4}$/.test(configuredPin)) {
        throw new Error("관리자 PIN이 설정되지 않았습니다. Apps Script 프로젝트 설정의 스크립트 속성을 확인해주세요.");
    }

    if (!constantTimeEquals(sha256Hex(pin), sha256Hex(configuredPin))) {
        const failures = (Number(cache.get(failureKey)) || 0) + 1;
        if (failures >= CONFIG.ADMIN_MAX_FAILURES) {
            cache.remove(failureKey);
            cache.put(lockKey, "1", CONFIG.ADMIN_LOCK_SECONDS);
            throw new Error("관리자 PIN 오류가 5회 발생했습니다. 10분 동안 잠겼습니다.");
        }
        cache.put(failureKey, String(failures), CONFIG.ADMIN_LOCK_SECONDS);
        throw new Error(`관리자 PIN이 맞지 않습니다. ${CONFIG.ADMIN_MAX_FAILURES - failures}회 남았습니다.`);
    }

    cache.remove(failureKey);
    cache.remove(lockKey);

    const token = `${Utilities.getUuid()}_${Utilities.getUuid()}`;
    const expiresAt = Date.now() + CONFIG.ADMIN_SESSION_SECONDS * 1000;
    cache.put(makeAdminTokenKey(token), String(expiresAt), CONFIG.ADMIN_SESSION_SECONDS);

    return {
        success: true,
        token,
        expiresIn: CONFIG.ADMIN_SESSION_SECONDS,
        expiresAt: new Date(expiresAt).toISOString()
    };
}

function requireAdminToken(tokenValue) {
    const token = cleanText(tokenValue);
    if (!token) throw new Error("관리자 인증이 필요합니다.");

    const cache = CacheService.getScriptCache();
    const cachedExpiry = Number(cache.get(makeAdminTokenKey(token)));
    if (!cachedExpiry || cachedExpiry <= Date.now()) {
        cache.remove(makeAdminTokenKey(token));
        throw new Error("관리자 인증 시간이 만료되었습니다.");
    }
    return true;
}

function makeAdminTokenKey(token) {
    return `ADMIN_TOKEN_${sha256Hex(token).slice(0, 40)}`;
}

function sha256Hex(value) {
    const bytes = Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        cleanText(value),
        Utilities.Charset.UTF_8
    );
    return bytes.map(function (byte) {
        const unsignedByte = byte < 0 ? byte + 256 : byte;
        return (`0${unsignedByte.toString(16)}`).slice(-2);
    }).join("");
}

function constantTimeEquals(leftValue, rightValue) {
    const left = cleanText(leftValue);
    const right = cleanText(rightValue);
    let difference = left.length ^ right.length;
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
    }
    return difference === 0;
}

function getData() {
    const sheet = getTargetSheet();
    return getEffectiveDataRows(sheet).map(function (item) {
        return {
            rowId: String(item.rowId),
            region: item.region,
            apartment: item.apartment,
            commonPassword: item.commonPassword,
            dong: item.dong,
            line: item.line,
            password: item.password
        };
    });
}

function getDataIntegrity() {
    let data = [];
    let versionBefore = "";
    let versionAfter = "";
    let stable = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        versionBefore = getDataVersion();
        data = getData();
        versionAfter = getDataVersion();
        if (versionBefore === versionAfter) {
            stable = true;
            break;
        }
    }
    const serialized = JSON.stringify(data);
    return {
        version: versionAfter || versionBefore,
        rowCount: data.length,
        checksum: fnv1aHashText(serialized),
        stable,
        checkedAt: formatTimestamp(new Date())
    };
}

function fnv1aHashText(value) {
    let hash = 0x811c9dc5;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (`00000000${(hash >>> 0).toString(16)}`).slice(-8);
}

function getEffectiveDataRows(sheet) {
    const lastRow = sheet.getLastRow();
    if (lastRow <= CONFIG.HEADER_ROW) return [];

    const startRow = CONFIG.HEADER_ROW + 1;
    const values = sheet.getRange(startRow, 1, lastRow - CONFIG.HEADER_ROW, CONFIG.PASSWORD_COLUMN).getDisplayValues();
    const result = [];
    let lastRegion = "";
    let lastApartment = "";

    for (let index = 0; index < values.length; index += 1) {
        const row = values[index];
        const rawRegion = cleanText(row[CONFIG.REGION_COLUMN - 1]);
        const rawApartment = cleanText(row[CONFIG.APARTMENT_COLUMN - 1]);
        const commonPassword = cleanText(row[CONFIG.COMMON_PASSWORD_COLUMN - 1]);
        const dong = cleanText(row[CONFIG.DONG_COLUMN - 1]);
        const line = cleanText(row[CONFIG.LINE_COLUMN - 1]);
        const password = cleanText(row[CONFIG.PASSWORD_COLUMN - 1]);
        const hasAnyValue = Boolean(rawRegion || rawApartment || commonPassword || dong || line || password);

        if (!hasAnyValue) {
            lastRegion = "";
            lastApartment = "";
            continue;
        }

        if (rawRegion) {
            if (lastRegion && normalizeCompareText(lastRegion) !== normalizeCompareText(rawRegion)) lastApartment = "";
            lastRegion = rawRegion;
        }

        const region = rawRegion || lastRegion;
        const normalizedRawApartment = normalizeApartmentValue(rawApartment);
        if (normalizedRawApartment) lastApartment = normalizedRawApartment;
        const apartment = normalizedRawApartment || lastApartment;

        if (!region || !apartment) continue;

        result.push({
            rowId: startRow + index,
            region,
            apartment,
            commonPassword,
            dong,
            line,
            password,
            rawRegion,
            rawApartment
        });
    }

    return result;
}

function isOfficeApartmentMarker(value) {
    const marker = cleanText(value).normalize("NFC").replace(/\s+/g, "").replace(/[.．。]+$/g, "").toUpperCase();
    return marker === "오피" || marker === "OP";
}

function normalizeApartmentValue(value) {
    const apartment = cleanText(value).normalize("NFC");
    return isOfficeApartmentMarker(apartment) ? "오피" : apartment;
}

function isOfficeDataRow(apartment) {
    return isOfficeApartmentMarker(apartment);
}

/* 최근 요청 개수만 시트 끝부분에서 직접 읽습니다. */
function getChangeHistory(limitValue) {
    const historySheet = getHistorySheet(false);
    if (!historySheet) return [];

    const lastRow = historySheet.getLastRow();
    if (lastRow <= 1) return [];

    const limit = Math.min(500, Math.max(1, parseInt(cleanText(limitValue), 10) || CONFIG.HISTORY_LIMIT));
    const availableRows = lastRow - 1;
    const readCount = Math.min(limit, availableRows);
    const startRow = lastRow - readCount + 1;
    const values = historySheet.getRange(startRow, 1, readCount, HISTORY_HEADERS.length).getDisplayValues();
    const result = [];

    for (let index = values.length - 1; index >= 0; index -= 1) {
        const row = values[index];
        const historyId = cleanText(row[HC.HISTORY_ID - 1]);
        if (!historyId) continue;

        const reverted = normalizeCompareText(row[HC.REVERTED - 1]) === "예";
        const changeType = cleanText(row[HC.CHANGE_TYPE - 1]);

        result.push({
            historyId,
            changedAt: cleanText(row[HC.CHANGED_AT - 1]),
            region: cleanText(row[HC.REGION - 1]),
            apartment: cleanText(row[HC.APARTMENT - 1]),
            dong: cleanText(row[HC.DONG - 1]),
            line: cleanText(row[HC.LINE - 1]),
            changeType,
            beforeValue: cleanText(row[HC.BEFORE_VALUE - 1]),
            afterValue: cleanText(row[HC.AFTER_VALUE - 1]),
            reverted,
            revertedAt: cleanText(row[HC.REVERTED_AT - 1]),
            canUndo: !reverted && changeType !== "되돌리기"
        });
    }

    return result;
}

function updateCommonPassword(data) {
    const region = cleanText(data.region);
    const apartment = cleanText(data.apartment);
    const commonPassword = cleanText(data.commonPassword);
    const operationId = ensureOperationId(data.operationId);

    if (!region) throw new Error("지역 정보가 없습니다.");
    if (!apartment) throw new Error("아파트 정보가 없습니다.");

    return withScriptLock(function () {
        const sheet = getTargetSheet();
        const historySheet = getHistorySheet(true);
        const duplicate = getDuplicateOperationResponse(historySheet, operationId);
        if (duplicate) return duplicate;

        const lastRow = sheet.getLastRow();
        if (lastRow <= CONFIG.HEADER_ROW) throw new Error("수정할 데이터가 없습니다.");

        const effectiveRows = getEffectiveDataRows(sheet);
        const restoreRows = [];
        const targetRows = [];
        const beforeValues = [];

        for (const rowInfo of effectiveRows) {
            if (normalizeCompareText(rowInfo.region) !== normalizeCompareText(region) ||
                normalizeCompareText(rowInfo.apartment) !== normalizeCompareText(apartment)) continue;

            restoreRows.push({ rowId: rowInfo.rowId, region: rowInfo.region, apartment: rowInfo.apartment, dong: rowInfo.dong, line: rowInfo.line, value: rowInfo.commonPassword });
            beforeValues.push(rowInfo.commonPassword);
            if (rowInfo.commonPassword !== commonPassword) targetRows.push(rowInfo.rowId);
        }

        if (restoreRows.length === 0) throw new Error("해당 아파트 데이터를 찾지 못했습니다.");
        if (targetRows.length === 0) {
            return { success: true, message: "이미 같은 공동비밀번호입니다.", commonPassword, updatedRows: 0 };
        }

        const historyEntry = appendHistory(historySheet, {
            operationId,
            region,
            apartment,
            dong: "",
            line: "",
            changeType: "공동비밀번호 수정",
            beforeValue: uniqueTextValues(beforeValues).join(" | "),
            afterValue: commonPassword,
            targetRow: targetRows.join(","),
            restoreData: JSON.stringify({ kind: "common", rows: restoreRows, expectedValue: commonPassword })
        });

        try {
            for (const rowId of targetRows) setCellPlainText(sheet.getRange(rowId, CONFIG.COMMON_PASSWORD_COLUMN), commonPassword);
            SpreadsheetApp.flush();
        } catch (error) {
            removeHistoryEntry(historySheet, historyEntry.rowNumber);
            throw error;
        }

        return {
            success: true,
            message: "공동비밀번호를 저장했습니다.",
            commonPassword,
            updatedRows: targetRows.length,
            historyId: historyEntry.historyId,
            version: bumpDataVersion()
        };
    });
}

function addPassword(data) {
    const rowId = parseRowId(data.rowId);
    const newPassword = cleanText(data.password);
    const operationId = ensureOperationId(data.operationId);
    if (!newPassword) throw new Error("추가할 비밀번호를 입력해주세요.");

    return withScriptLock(function () {
        const sheet = getTargetSheet();
        const historySheet = getHistorySheet(true);
        const duplicate = getDuplicateOperationResponse(historySheet, operationId);
        if (duplicate) return duplicate;

        validateRowId(sheet, rowId);
        const rowInfo = getRowInfo(sheet, rowId);
        const passwordCell = sheet.getRange(rowId, CONFIG.PASSWORD_COLUMN);
        const currentValue = cleanText(passwordCell.getDisplayValue());
        const expectedPassword = data && Object.prototype.hasOwnProperty.call(data, "expectedPassword") ? cleanText(data.expectedPassword) : null;
        if (expectedPassword !== null && currentValue !== expectedPassword) {
            throw new Error("다른 기기나 구글시트에서 비밀번호가 먼저 변경되었습니다. 최신 데이터를 확인한 뒤 다시 시도해주세요.");
        }
        const currentPasswords = splitPasswords(currentValue);
        const normalizedNewPassword = normalizePassword(newPassword);

        const duplicateExists = currentPasswords.some(password => normalizePassword(password) === normalizedNewPassword);
        if (duplicateExists) {
            return { success: true, message: "이미 저장된 비밀번호입니다.", rowId: String(rowId), password: currentValue };
        }

        currentPasswords.push(newPassword);
        const updatedPassword = sortPasswords(currentPasswords).join(CONFIG.PASSWORD_SEPARATOR);
        const historyEntry = appendHistory(historySheet, {
            operationId,
            region: rowInfo.region,
            apartment: rowInfo.apartment,
            dong: rowInfo.dong,
            line: rowInfo.line,
            changeType: "비밀번호 추가",
            beforeValue: currentValue,
            afterValue: updatedPassword,
            targetRow: String(rowId),
            restoreData: JSON.stringify({ kind: "rowPassword", rowId, region: rowInfo.region, apartment: rowInfo.apartment, dong: rowInfo.dong, line: rowInfo.line, value: currentValue, expectedValue: updatedPassword })
        });

        try {
            setCellPlainText(passwordCell, updatedPassword);
            SpreadsheetApp.flush();
        } catch (error) {
            removeHistoryEntry(historySheet, historyEntry.rowNumber);
            throw error;
        }

        return { success: true, message: "비밀번호를 추가했습니다.", rowId: String(rowId), password: updatedPassword, historyId: historyEntry.historyId, version: bumpDataVersion() };
    });
}

function updatePassword(data) {
    const rowId = parseRowId(data.rowId);
    const oldPassword = cleanText(data.oldPassword);
    const newPassword = cleanText(data.newPassword);
    const operationId = ensureOperationId(data.operationId);

    if (!oldPassword) throw new Error("수정할 기존 비밀번호가 없습니다.");
    if (!newPassword) throw new Error("새 비밀번호를 입력해주세요.");

    return withScriptLock(function () {
        const sheet = getTargetSheet();
        const historySheet = getHistorySheet(true);
        const duplicate = getDuplicateOperationResponse(historySheet, operationId);
        if (duplicate) return duplicate;

        validateRowId(sheet, rowId);
        const rowInfo = getRowInfo(sheet, rowId);
        const passwordCell = sheet.getRange(rowId, CONFIG.PASSWORD_COLUMN);
        const currentValue = cleanText(passwordCell.getDisplayValue());
        const expectedPassword = data && Object.prototype.hasOwnProperty.call(data, "expectedPassword") ? cleanText(data.expectedPassword) : null;
        if (expectedPassword !== null && currentValue !== expectedPassword) {
            throw new Error("다른 기기나 구글시트에서 비밀번호가 먼저 변경되었습니다. 최신 데이터를 확인한 뒤 다시 시도해주세요.");
        }
        const currentPasswords = splitPasswords(currentValue);
        const oldKey = normalizePassword(oldPassword);
        const newKey = normalizePassword(newPassword);
        const targetIndex = currentPasswords.findIndex(password => normalizePassword(password) === oldKey);

        if (targetIndex < 0) {
            if (currentPasswords.some(password => normalizePassword(password) === newKey)) {
                return { success: true, message: "이미 수정된 비밀번호입니다.", rowId: String(rowId), password: currentValue };
            }
            throw new Error("수정할 비밀번호를 찾지 못했습니다.");
        }

        if (oldKey === newKey) {
            return { success: true, message: "변경된 내용이 없습니다.", rowId: String(rowId), password: currentValue };
        }

        const duplicateExists = currentPasswords.some(function (password, index) {
            return index !== targetIndex && normalizePassword(password) === newKey;
        });
        if (duplicateExists) throw new Error("이미 저장된 비밀번호입니다.");

        currentPasswords[targetIndex] = newPassword;
        const updatedPassword = sortPasswords(currentPasswords).join(CONFIG.PASSWORD_SEPARATOR);
        const historyEntry = appendHistory(historySheet, {
            operationId,
            region: rowInfo.region,
            apartment: rowInfo.apartment,
            dong: rowInfo.dong,
            line: rowInfo.line,
            changeType: "비밀번호 수정",
            beforeValue: currentValue,
            afterValue: updatedPassword,
            targetRow: String(rowId),
            restoreData: JSON.stringify({ kind: "rowPassword", rowId, region: rowInfo.region, apartment: rowInfo.apartment, dong: rowInfo.dong, line: rowInfo.line, value: currentValue, expectedValue: updatedPassword })
        });

        try {
            setCellPlainText(passwordCell, updatedPassword);
            SpreadsheetApp.flush();
        } catch (error) {
            removeHistoryEntry(historySheet, historyEntry.rowNumber);
            throw error;
        }

        return { success: true, message: "비밀번호를 수정했습니다.", rowId: String(rowId), password: updatedPassword, historyId: historyEntry.historyId, version: bumpDataVersion() };
    });
}

function deletePassword(data) {
    const rowId = parseRowId(data.rowId);
    const deleteTarget = cleanText(data.password);
    const operationId = ensureOperationId(data.operationId);
    if (!deleteTarget) throw new Error("삭제할 비밀번호가 없습니다.");

    return withScriptLock(function () {
        const sheet = getTargetSheet();
        const historySheet = getHistorySheet(true);
        const duplicate = getDuplicateOperationResponse(historySheet, operationId);
        if (duplicate) return duplicate;

        validateRowId(sheet, rowId);
        const rowInfo = getRowInfo(sheet, rowId);
        const passwordCell = sheet.getRange(rowId, CONFIG.PASSWORD_COLUMN);
        const currentValue = cleanText(passwordCell.getDisplayValue());
        const expectedPassword = data && Object.prototype.hasOwnProperty.call(data, "expectedPassword") ? cleanText(data.expectedPassword) : null;
        if (expectedPassword !== null && currentValue !== expectedPassword) {
            throw new Error("다른 기기나 구글시트에서 비밀번호가 먼저 변경되었습니다. 최신 데이터를 확인한 뒤 다시 시도해주세요.");
        }
        const currentPasswords = splitPasswords(currentValue);
        const normalizedTarget = normalizePassword(deleteTarget);
        const updatedPasswords = sortPasswords(currentPasswords.filter(password => normalizePassword(password) !== normalizedTarget));

        if (updatedPasswords.length === currentPasswords.length) {
            return { success: true, message: "이미 삭제된 비밀번호입니다.", rowId: String(rowId), password: currentValue };
        }

        const updatedPassword = updatedPasswords.join(CONFIG.PASSWORD_SEPARATOR);
        const historyEntry = appendHistory(historySheet, {
            operationId,
            region: rowInfo.region,
            apartment: rowInfo.apartment,
            dong: rowInfo.dong,
            line: rowInfo.line,
            changeType: "비밀번호 삭제",
            beforeValue: currentValue,
            afterValue: updatedPassword,
            targetRow: String(rowId),
            restoreData: JSON.stringify({ kind: "rowPassword", rowId, region: rowInfo.region, apartment: rowInfo.apartment, dong: rowInfo.dong, line: rowInfo.line, value: currentValue, expectedValue: updatedPassword })
        });

        try {
            setCellPlainText(passwordCell, updatedPassword);
            SpreadsheetApp.flush();
        } catch (error) {
            removeHistoryEntry(historySheet, historyEntry.rowNumber);
            throw error;
        }

        return { success: true, message: "비밀번호를 삭제했습니다.", rowId: String(rowId), password: updatedPassword, historyId: historyEntry.historyId, version: bumpDataVersion() };
    });
}

function undoChange(data) {
    const historyId = cleanText(data.historyId);
    const operationId = ensureOperationId(data.operationId);
    if (!historyId) throw new Error("되돌릴 기록을 찾지 못했습니다.");

    return withScriptLock(function () {
        const sheet = getTargetSheet();
        const historySheet = getHistorySheet(true);
        const duplicate = getDuplicateOperationResponse(historySheet, operationId);
        if (duplicate) return duplicate;

        const historyRowNumber = findHistoryRowById(historySheet, historyId);
        if (!historyRowNumber) throw new Error("해당 수정기록을 찾지 못했습니다.");

        const historyValues = historySheet.getRange(historyRowNumber, 1, 1, HISTORY_HEADERS.length).getDisplayValues()[0];
        const changeType = cleanText(historyValues[HC.CHANGE_TYPE - 1]);
        const reverted = normalizeCompareText(historyValues[HC.REVERTED - 1]) === "예";

        if (changeType === "되돌리기") throw new Error("되돌리기 기록은 다시 되돌릴 수 없습니다.");
        if (reverted) return { success: true, message: "이미 되돌린 기록입니다.", historyId };

        const restoreDataText = cleanText(historyValues[HC.RESTORE_DATA - 1]);
        if (!restoreDataText) throw new Error("복원 정보가 없는 기록입니다.");

        let restoreData;
        try {
            restoreData = JSON.parse(restoreDataText);
        } catch (error) {
            throw new Error("복원 정보를 읽지 못했습니다.");
        }

        const now = formatTimestamp(new Date());
        const undoHistory = appendHistory(historySheet, {
            operationId,
            region: cleanText(historyValues[HC.REGION - 1]),
            apartment: cleanText(historyValues[HC.APARTMENT - 1]),
            dong: cleanText(historyValues[HC.DONG - 1]),
            line: cleanText(historyValues[HC.LINE - 1]),
            changeType: "되돌리기",
            beforeValue: cleanText(historyValues[HC.AFTER_VALUE - 1]),
            afterValue: cleanText(historyValues[HC.BEFORE_VALUE - 1]),
            targetRow: cleanText(historyValues[HC.TARGET_ROW - 1]),
            originalHistoryId: historyId,
            restoreData: ""
        });

        historySheet.getRange(historyRowNumber, HC.REVERTED).setValue("예");
        historySheet.getRange(historyRowNumber, HC.REVERTED_AT).setValue(now);
        historySheet.getRange(historyRowNumber, HC.REVERT_OPERATION_ID).setValue(operationId);

        try {
            restoreFromHistoryData(sheet, restoreData);
            SpreadsheetApp.flush();
        } catch (error) {
            removeHistoryEntry(historySheet, undoHistory.rowNumber);
            historySheet.getRange(historyRowNumber, HC.REVERTED).setValue("아니오");
            historySheet.getRange(historyRowNumber, HC.REVERTED_AT).clearContent();
            historySheet.getRange(historyRowNumber, HC.REVERT_OPERATION_ID).clearContent();
            throw error;
        }

        return { success: true, message: "이전 값으로 되돌렸습니다.", historyId, undoHistoryId: undoHistory.historyId, version: bumpDataVersion() };
    });
}

function restoreFromHistoryData(sheet, restoreData) {
    const kind = cleanText(restoreData && restoreData.kind);

    if (kind === "common") {
        const rows = Array.isArray(restoreData.rows) ? restoreData.rows : [];
        const expectedValue = cleanText(restoreData.expectedValue);
        const resolvedRows = [];

        for (const item of rows) {
            const rowId = resolveRestoreRow(sheet, item);
            if (!rowId) continue;
            const currentValue = cleanText(sheet.getRange(rowId, CONFIG.COMMON_PASSWORD_COLUMN).getDisplayValue());
            if (currentValue !== expectedValue) throw new Error("이후에 공동비밀번호가 다시 변경되어 이 기록을 바로 되돌릴 수 없습니다.");
            resolvedRows.push({ rowId, value: cleanText(item.value) });
        }

        if (resolvedRows.length === 0) throw new Error("복원할 공동비밀번호 행을 찾지 못했습니다.");
        for (const item of resolvedRows) setCellPlainText(sheet.getRange(item.rowId, CONFIG.COMMON_PASSWORD_COLUMN), item.value);
        return;
    }

    if (kind === "rowPassword") {
        const rowId = resolveRestoreRow(sheet, restoreData);
        if (!rowId) throw new Error("복원할 비밀번호 행을 찾지 못했습니다.");
        const currentValue = cleanText(sheet.getRange(rowId, CONFIG.PASSWORD_COLUMN).getDisplayValue());
        if (currentValue !== cleanText(restoreData.expectedValue)) throw new Error("이후에 비밀번호가 다시 변경되어 이 기록을 바로 되돌릴 수 없습니다.");
        setCellPlainText(sheet.getRange(rowId, CONFIG.PASSWORD_COLUMN), cleanText(restoreData.value));
        return;
    }

    if (kind === "bulkRowPasswords") {
        const rows = Array.isArray(restoreData.rows) ? restoreData.rows : [];
        const resolvedRows = [];
        for (const item of rows) {
            const rowId = resolveRestoreRow(sheet, item);
            if (!rowId) throw new Error("일괄 정리로 변경된 일부 행을 찾지 못했습니다.");
            const currentValue = cleanText(sheet.getRange(rowId, CONFIG.PASSWORD_COLUMN).getDisplayValue());
            if (currentValue !== cleanText(item.expectedValue)) {
                throw new Error("일괄 정리 후 일부 비밀번호가 다시 변경되어 바로 되돌릴 수 없습니다.");
            }
            resolvedRows.push({ rowId, value: cleanText(item.value) });
        }
        if (resolvedRows.length === 0) throw new Error("복원할 비밀번호 행이 없습니다.");
        for (const item of resolvedRows) setCellPlainText(sheet.getRange(item.rowId, CONFIG.PASSWORD_COLUMN), item.value);
        return;
    }

    throw new Error("지원하지 않는 복원 형식입니다.");
}

function resolveRestoreRow(sheet, item) {
    const requestedRow = parseInt(cleanText(item && item.rowId), 10);
    const expectedRegion = cleanText(item && item.region);
    const expectedApartment = cleanText(item && item.apartment);
    const expectedDong = cleanText(item && item.dong);
    const expectedLine = cleanText(item && item.line);

    if (Number.isInteger(requestedRow) && requestedRow > CONFIG.HEADER_ROW && requestedRow <= sheet.getLastRow()) {
        const current = getRowInfo(sheet, requestedRow);
        if (sameRowIdentity(current, expectedRegion, expectedApartment, expectedDong, expectedLine)) return requestedRow;
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= CONFIG.HEADER_ROW) return 0;
    const values = sheet.getRange(CONFIG.HEADER_ROW + 1, 1, lastRow - CONFIG.HEADER_ROW, CONFIG.PASSWORD_COLUMN).getDisplayValues();

    for (let index = 0; index < values.length; index += 1) {
        const row = values[index];
        const current = {
            region: cleanText(row[CONFIG.REGION_COLUMN - 1]),
            apartment: normalizeApartmentValue(row[CONFIG.APARTMENT_COLUMN - 1]),
            dong: cleanText(row[CONFIG.DONG_COLUMN - 1]),
            line: cleanText(row[CONFIG.LINE_COLUMN - 1])
        };
        if (sameRowIdentity(current, expectedRegion, expectedApartment, expectedDong, expectedLine)) return CONFIG.HEADER_ROW + 1 + index;
    }

    return 0;
}

function sameRowIdentity(current, region, apartment, dong, line) {
    return normalizeCompareText(current.region) === normalizeCompareText(region) &&
        normalizeCompareText(normalizeApartmentValue(current.apartment)) === normalizeCompareText(normalizeApartmentValue(apartment)) &&
        normalizeCompareText(current.dong) === normalizeCompareText(dong) &&
        normalizeCompareText(current.line) === normalizeCompareText(line);
}

function getRowInfo(sheet, rowId) {
    const effective = getEffectiveDataRows(sheet).find(function (item) { return Number(item.rowId) === Number(rowId); });
    if (effective) return {
        region: effective.region,
        apartment: effective.apartment,
        commonPassword: effective.commonPassword,
        dong: effective.dong,
        line: effective.line,
        password: effective.password
    };

    const row = sheet.getRange(rowId, 1, 1, CONFIG.PASSWORD_COLUMN).getDisplayValues()[0];
    return {
        region: cleanText(row[CONFIG.REGION_COLUMN - 1]),
        apartment: normalizeApartmentValue(row[CONFIG.APARTMENT_COLUMN - 1]),
        commonPassword: cleanText(row[CONFIG.COMMON_PASSWORD_COLUMN - 1]),
        dong: cleanText(row[CONFIG.DONG_COLUMN - 1]),
        line: cleanText(row[CONFIG.LINE_COLUMN - 1]),
        password: cleanText(row[CONFIG.PASSWORD_COLUMN - 1])
    };
}

function appendHistory(historySheet, data) {
    const historyId = Utilities.getUuid();
    const rowNumber = historySheet.getLastRow() + 1;
    const row = [
        historyId,
        cleanText(data.operationId),
        formatTimestamp(new Date()),
        cleanText(data.region),
        cleanText(data.apartment),
        cleanText(data.dong),
        cleanText(data.line),
        cleanText(data.changeType),
        cleanText(data.beforeValue),
        cleanText(data.afterValue),
        "아니오",
        "",
        cleanText(data.targetRow),
        cleanText(data.originalHistoryId),
        "",
        cleanText(data.restoreData)
    ];

    const range = historySheet.getRange(rowNumber, 1, 1, HISTORY_HEADERS.length);
    range.setNumberFormat("@");
    range.setValues([row]);
    return { historyId, rowNumber };
}

function removeHistoryEntry(historySheet, rowNumber) {
    if (Number.isInteger(rowNumber) && rowNumber > 1 && rowNumber <= historySheet.getLastRow()) {
        historySheet.deleteRow(rowNumber);
    }
}

function getDuplicateOperationResponse(historySheet, operationId) {
    if (!operationId) return null;
    const rowNumber = findHistoryRowByOperationId(historySheet, operationId);
    if (!rowNumber) return null;

    const historyId = cleanText(historySheet.getRange(rowNumber, HC.HISTORY_ID).getDisplayValue());
    return { success: true, duplicate: true, message: "이미 처리된 작업입니다.", historyId, version: getDataVersion() };
}

function findHistoryRowByOperationId(historySheet, operationId) {
    return findHistoryRowByColumn(historySheet, HC.OPERATION_ID, operationId);
}

function findHistoryRowById(historySheet, historyId) {
    return findHistoryRowByColumn(historySheet, HC.HISTORY_ID, historyId);
}

function findHistoryRowByColumn(historySheet, column, targetValue) {
    const target = cleanText(targetValue);
    const lastRow = historySheet.getLastRow();
    if (!target || lastRow <= 1) return 0;

    const values = historySheet.getRange(2, column, lastRow - 1, 1).getDisplayValues();
    for (let index = values.length - 1; index >= 0; index -= 1) {
        if (cleanText(values[index][0]) === target) return index + 2;
    }
    return 0;
}

function getDataVersion() {
    const properties = PropertiesService.getScriptProperties();
    let version = cleanText(properties.getProperty(CONFIG.DATA_VERSION_PROPERTY));
    if (!version) {
        version = String(Date.now());
        properties.setProperty(CONFIG.DATA_VERSION_PROPERTY, version);
    }
    return version;
}

function bumpDataVersion() {
    const version = `${Date.now()}_${Utilities.getUuid().slice(0, 8)}`;
    PropertiesService.getScriptProperties().setProperty(CONFIG.DATA_VERSION_PROPERTY, version);
    return version;
}

/* 구글시트에서 A~F열을 직접 수정하면 데이터 버전을 자동 변경합니다. */
function onEdit(e) {
    try {
        if (!e || !e.range) return;

        const range = e.range;
        const sheet = range.getSheet();
        if (!isTargetDataSheet(sheet)) return;

        const lastRow = range.getLastRow();
        const firstColumn = range.getColumn();
        const lastColumn = range.getLastColumn();

        if (lastRow <= CONFIG.HEADER_ROW) return;
        if (lastColumn < CONFIG.REGION_COLUMN || firstColumn > CONFIG.PASSWORD_COLUMN) return;

        bumpDataVersion();
    } catch (error) {
        console.error("시트 직접 수정 버전 갱신 실패:", error);
    }
}

function isTargetDataSheet(sheet) {
    if (!sheet) return false;
    try {
        return getTargetSheet().getSheetId() === sheet.getSheetId();
    } catch (error) {
        return false;
    }
}


/* ========================= 익명 앱 사용 현황 ========================= */
function getUsageSheet(createIfMissing) {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = spreadsheet.getSheetByName(CONFIG.USAGE_SHEET_NAME);
    if (!sheet && createIfMissing) {
        sheet = spreadsheet.insertSheet(CONFIG.USAGE_SHEET_NAME);
        sheet.getRange(1, 1, 1, 4).setValues([["날짜", "익명기기", "첫사용", "마지막활동"]]);
        sheet.setFrozenRows(1);
        try { sheet.hideSheet(); } catch (error) {}
    }
    return sheet;
}


function normalizeUsageDateKey(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return Utilities.formatDate(value, CONFIG.TIME_ZONE, "yyyy-MM-dd");
    }
    const text = cleanText(value);
    const direct = text.match(/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})$/);
    if (direct) return `${direct[1]}-${String(Number(direct[2])).padStart(2, "0")}-${String(Number(direct[3])).padStart(2, "0")}`;
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return Utilities.formatDate(parsed, CONFIG.TIME_ZONE, "yyyy-MM-dd");
    return "";
}

function recordUsage(data) {
    const rawClientId = cleanText(data && data.clientId);
    if (!rawClientId || rawClientId.length < 12 || rawClientId.length > 160) {
        throw new Error("사용 기기 식별값이 올바르지 않습니다.");
    }
    const now = new Date();
    const today = Utilities.formatDate(now, CONFIG.TIME_ZONE, "yyyy-MM-dd");
    const clientHash = sha256Hex(rawClientId).slice(0, 32);
    const lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
        const sheet = getUsageSheet(true);
        const lastRow = sheet.getLastRow();
        let targetRow = 0;
        if (lastRow >= 2) {
            const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
            for (let index = values.length - 1; index >= 0; index -= 1) {
                const rowDate = normalizeUsageDateKey(values[index][0]);
                if (rowDate !== today) continue;
                if (cleanText(values[index][1]) === clientHash) {
                    targetRow = index + 2;
                    break;
                }
            }
        }
        if (targetRow) sheet.getRange(targetRow, 4).setValue(now);
        else sheet.appendRow([today, clientHash, now, now]);
        cleanupOldUsageRows(sheet, now);
    } finally {
        lock.releaseLock();
    }
    return { success: true, recordedAt: formatTimestamp(now) };
}

function cleanupOldUsageRows(sheet, now) {
    const cache = CacheService.getScriptCache();
    const cleanupKey = "USAGE_CLEANUP_V1";
    if (cache.get(cleanupKey)) return;
    cache.put(cleanupKey, "1", 6 * 60 * 60);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const cutoff = new Date(now.getTime() - CONFIG.USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const cutoffText = Utilities.formatDate(cutoff, CONFIG.TIME_ZONE, "yyyy-MM-dd");
    const dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    const deleteRows = [];
    for (let index = 0; index < dates.length; index += 1) {
        const value = normalizeUsageDateKey(dates[index][0]);
        if (value && value < cutoffText) deleteRows.push(index + 2);
    }
    for (let index = deleteRows.length - 1; index >= 0; index -= 1) sheet.deleteRow(deleteRows[index]);
}

function getUsageStatistics() {
    const now = new Date();
    const today = Utilities.formatDate(now, CONFIG.TIME_ZONE, "yyyy-MM-dd");
    const activeCutoff = now.getTime() - CONFIG.USAGE_ACTIVE_MINUTES * 60 * 1000;
    const sheet = getUsageSheet(false);
    if (!sheet || sheet.getLastRow() < 2) {
        return { todayUsers: 0, activeUsers: 0, activeMinutes: CONFIG.USAGE_ACTIVE_MINUTES, checkedAt: formatTimestamp(now) };
    }
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
    const todayClients = {};
    const activeClients = {};
    for (const row of rows) {
        if (normalizeUsageDateKey(row[0]) !== today) continue;
        const clientHash = cleanText(row[1]);
        if (!clientHash) continue;
        todayClients[clientHash] = true;
        const lastSeen = row[3] instanceof Date ? row[3].getTime() : new Date(row[3]).getTime();
        if (Number.isFinite(lastSeen) && lastSeen >= activeCutoff) activeClients[clientHash] = true;
    }
    return {
        todayUsers: Object.keys(todayClients).length,
        activeUsers: Object.keys(activeClients).length,
        activeMinutes: CONFIG.USAGE_ACTIVE_MINUTES,
        checkedAt: formatTimestamp(now)
    };
}

function getAdminDashboard() {
    const sheet = getTargetSheet();
    const rows = getEffectiveDataRows(sheet);
    const regions = {};
    const apartments = {};
    const officeBuildings = {};
    let passwordRowCount = 0;
    let blankPasswordRowCount = 0;

    for (const row of rows) {
        regions[normalizeCompareText(row.region)] = true;
        if (isOfficeDataRow(row.apartment)) {
            const building = cleanText(row.dong);
            if (building) officeBuildings[`${normalizeCompareText(row.region)}\u0000${normalizeCompareText(building)}`] = true;
        } else {
            apartments[`${normalizeCompareText(row.region)}\u0000${normalizeCompareText(row.apartment)}`] = true;
        }
        if (cleanText(row.password)) passwordRowCount += 1;
        else blankPasswordRowCount += 1;
    }

    const historySheet = getHistorySheet(false);
    const historyCount = historySheet ? Math.max(0, historySheet.getLastRow() - 1) : 0;
    let autoBackup;
    try {
        ensureDailyBackupTrigger();
        autoBackup = getAutoBackupStatus();
    } catch (error) {
        autoBackup = {
            enabled: false,
            healthy: false,
            needsAttention: true,
            status: "error",
            schedule: "매일 06시경",
            timezone: CONFIG.TIME_ZONE,
            message: `자동 백업 상태 확인 실패: ${error.message}`,
            lastSuccessAt: "",
            lastFailureAt: "",
            lastFailureMessage: cleanText(error.message)
        };
    }

    const backups = listBackups();
    const dataQuality = getDataQualityReport(sheet, rows);
    const statistics = getAdminStatistics(rows, historySheet);
    const usage = getUsageStatistics();

    return {
        dataSheetName: sheet.getName(),
        totalRows: rows.length,
        regionCount: Object.keys(regions).length,
        apartmentCount: Object.keys(apartments).length,
        officeBuildingCount: Object.keys(officeBuildings).length,
        passwordRowCount,
        blankPasswordRowCount,
        historyCount,
        dataVersion: getDataVersion(),
        checkedAt: formatTimestamp(new Date()),
        dataQuality,
        statistics,
        usage,
        autoBackup,
        backups
    };
}


function getAdminStatistics(rows, historySheet) {
    const historyLastRow = historySheet ? historySheet.getLastRow() : 0;
    const cacheKey = `ADMIN_STATS_${sha256Hex(`${getDataVersion()}_${historyLastRow}`).slice(0, 28)}`;
    const cache = CacheService.getScriptCache();
    const cached = cache.get(cacheKey);
    if (cached) {
        try { return JSON.parse(cached); } catch (error) {}
    }
    const dongKeys = {};
    const lineKeys = {};
    const commonKeys = {};
    const regionMap = {};
    let passwordCount = 0;

    for (const row of rows) {
        const region = cleanText(row.region);
        const apartment = cleanText(row.apartment);
        const dong = cleanText(row.dong);
        const line = cleanText(row.line);
        const placeName = isOfficeDataRow(apartment) ? dong : apartment;
        const placeKey = `${normalizeCompareText(region)}\u0000${normalizeCompareText(placeName)}`;
        const dongKey = `${placeKey}\u0000${normalizeCompareText(dong)}`;
        const lineKey = `${dongKey}\u0000${normalizeCompareText(line)}`;
        if (dong) dongKeys[dongKey] = true;
        if (line) lineKeys[lineKey] = true;
        if (cleanText(row.commonPassword)) commonKeys[placeKey] = true;
        passwordCount += splitPasswords(row.password).length;

        const regionKey = normalizeCompareText(region);
        if (!regionMap[regionKey]) regionMap[regionKey] = { region, places: {}, dongs: {}, lines: {}, passwordCount: 0 };
        const bucket = regionMap[regionKey];
        bucket.places[placeKey] = true;
        if (dong) bucket.dongs[dongKey] = true;
        if (line) bucket.lines[lineKey] = true;
        bucket.passwordCount += splitPasswords(row.password).length;
    }

    const regionStats = Object.keys(regionMap).map(function (key) {
        const item = regionMap[key];
        return {
            region: item.region,
            placeCount: Object.keys(item.places).length,
            dongCount: Object.keys(item.dongs).length,
            lineCount: Object.keys(item.lines).length,
            passwordCount: item.passwordCount
        };
    }).sort(function (a, b) { return a.region.localeCompare(b.region, "ko", { numeric: true }); });

    const activity = getAdminActivityStatistics(historySheet);
    const result = {
        dongCount: Object.keys(dongKeys).length,
        lineCount: Object.keys(lineKeys).length,
        passwordCount,
        commonPasswordPlaceCount: Object.keys(commonKeys).length,
        averagePasswordsPerLine: Object.keys(lineKeys).length ? Math.round((passwordCount / Object.keys(lineKeys).length) * 100) / 100 : 0,
        regionStats,
        recent7Days: activity.recent7Days,
        recent30Days: activity.recent30Days,
        changeTypes: activity.changeTypes,
        topApartments: activity.topApartments,
        activitySampleLimited: activity.sampleLimited
    };
    try { cache.put(cacheKey, JSON.stringify(result), 10 * 60); } catch (error) {}
    return result;
}

function getAdminActivityStatistics(historySheet) {
    const empty = { recent7Days: 0, recent30Days: 0, changeTypes: [], topApartments: [], sampleLimited: false };
    if (!historySheet || historySheet.getLastRow() <= 1) return empty;

    const totalRows = historySheet.getLastRow() - 1;
    const readCount = Math.min(totalRows, 5000);
    const startRow = historySheet.getLastRow() - readCount + 1;
    const values = historySheet.getRange(startRow, 1, readCount, HISTORY_HEADERS.length).getDisplayValues();
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const changeTypeCounts = {};
    const apartmentCounts = {};
    let recent7Days = 0;
    let recent30Days = 0;

    for (const row of values) {
        const changedAt = parseHistoryTimestamp(row[HC.CHANGED_AT - 1]);
        if (changedAt >= thirtyDaysAgo) recent30Days += 1;
        if (changedAt >= sevenDaysAgo) recent7Days += 1;
        const changeType = cleanText(row[HC.CHANGE_TYPE - 1]);
        if (changeType) changeTypeCounts[changeType] = (changeTypeCounts[changeType] || 0) + 1;
        const region = cleanText(row[HC.REGION - 1]);
        const apartment = cleanText(row[HC.APARTMENT - 1]);
        if (apartment) {
            const key = `${region}\u0000${apartment}`;
            if (!apartmentCounts[key]) apartmentCounts[key] = { region, apartment, count: 0 };
            apartmentCounts[key].count += 1;
        }
    }

    return {
        recent7Days,
        recent30Days,
        changeTypes: Object.keys(changeTypeCounts).map(function (key) { return { type: key, count: changeTypeCounts[key] }; }).sort(function (a, b) { return b.count - a.count; }),
        topApartments: Object.keys(apartmentCounts).map(function (key) { return apartmentCounts[key]; }).sort(function (a, b) { return b.count - a.count; }).slice(0, 10),
        sampleLimited: totalRows > readCount
    };
}

function parseHistoryTimestamp(value) {
    const match = cleanText(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!match) return 0;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])).getTime();
}

/* 관리자 화면용 데이터 품질 점검 결과를 데이터 버전별로 잠시 캐시합니다. */
function getDataQualityReport(sheet, rows) {
    const version = getDataVersion();
    const cacheKey = `DATA_QUALITY_${CONFIG.DATA_QUALITY_REPORT_VERSION}_${sha256Hex(version).slice(0, 24)}`;
    const cache = CacheService.getScriptCache();
    const cachedText = cache.get(cacheKey);
    if (cachedText) {
        try {
            const cached = JSON.parse(cachedText);
            if (cached && typeof cached === "object") return cached;
        } catch (error) {}
    }

    const report = inspectDataQuality(sheet, rows);
    try {
        cache.put(cacheKey, JSON.stringify(report), CONFIG.DATA_QUALITY_CACHE_SECONDS);
    } catch (error) {
        console.warn("데이터 오류 점검 캐시 저장 실패:", error);
    }
    return report;
}

function inspectDataQuality(sheet, rows) {
    const detailLimit = CONFIG.DATA_QUALITY_DETAIL_LIMIT;
    const duplicateLineMap = {};
    const duplicatePasswordItems = [];
    const delimiterItems = [];
    const unsortedItems = [];

    for (const row of rows) {
        const rowId = Number(row.rowId);
        const region = cleanText(row.region);
        const apartment = cleanText(row.apartment);
        const dong = cleanText(row.dong);
        const line = cleanText(row.line);
        const identityLabel = makeDataRowLabel(row);


        if (region && apartment && dong && line) {
            const key = [region, apartment, dong, line].map(normalizeCompareText).join("\u0000");
            if (!duplicateLineMap[key]) duplicateLineMap[key] = { label: identityLabel, rowIds: [] };
            duplicateLineMap[key].rowIds.push(rowId);
        }

        const passwordText = cleanText(row.password);
        if (!passwordText) continue;
        const rawTokens = splitPasswordTokens(passwordText);
        if (rawTokens.length === 0) continue;

        const seen = {};
        const duplicated = [];
        for (const token of rawTokens) {
            const normalized = normalizePassword(token);
            if (seen[normalized] && duplicated.indexOf(token) < 0) duplicated.push(token);
            seen[normalized] = true;
        }
        if (duplicated.length > 0) {
            duplicatePasswordItems.push(`${rowId}행 · ${identityLabel} · 중복: ${duplicated.join(", ")}`);
        }

        const canonicalSameOrder = rawTokens.join(CONFIG.PASSWORD_SEPARATOR);
        if (rawTokens.length > 1 && passwordText !== canonicalSameOrder) {
            delimiterItems.push(`${rowId}행 · ${identityLabel} · ${passwordText}`);
        }

        if (duplicated.length === 0 && rawTokens.length > 1) {
            const sortedTokens = sortPasswords(rawTokens);
            const originalKeys = rawTokens.map(normalizePassword).join("\u0000");
            const sortedKeys = sortedTokens.map(normalizePassword).join("\u0000");
            if (originalKeys !== sortedKeys) {
                unsortedItems.push(`${rowId}행 · ${identityLabel} · ${passwordText}`);
            }
        }
    }

    const duplicateLineItems = Object.keys(duplicateLineMap)
        .map(function (key) { return duplicateLineMap[key]; })
        .filter(function (item) { return item.rowIds.length > 1; })
        .map(function (item) { return `${item.rowIds.join(", ")}행 · ${item.label}`; });

    const categories = [
        makeDataQualityCategory("duplicateLines", "동·라인 중복", duplicateLineItems, "danger", detailLimit),
        makeDataQualityCategory("duplicatePasswords", "행 내부 중복 비밀번호", duplicatePasswordItems, "danger", detailLimit),
        makeDataQualityCategory("delimiterFormat", "비밀번호 구분기호 이상", delimiterItems, "warning", detailLimit),
        makeDataQualityCategory("unsortedPasswords", "비밀번호 우선순위·호수 정렬 이상", unsortedItems, "warning", detailLimit)
    ];
    const totalIssues = categories.reduce(function (sum, category) { return sum + category.count; }, 0);
    const cleanup = countPasswordCleanupCandidates(sheet);

    return {
        checkedAt: formatTimestamp(new Date()),
        checkedRows: rows.length,
        totalIssues,
        healthy: totalIssues === 0,
        cleanup,
        categories
    };
}


/* 자동 정리는 정확히 " / " 구분기호를 사용한 행만 대상으로 합니다.
   우선순위·호수 정렬은 중복을 유지하고, 중복 제거는 기존 순서를 유지합니다. */
function inspectPasswordCleanupCandidate(passwordValue) {
    const passwordText = passwordValue === null || passwordValue === undefined ? "" : String(passwordValue);
    if (!passwordText || passwordText !== passwordText.trim()) {
        return { tokens: [], canonical: false, sortable: false, duplicateRemovable: false };
    }

    const tokens = passwordText.split(CONFIG.PASSWORD_SEPARATOR);
    const canonical = tokens.length > 0 &&
        tokens.every(function (token) { return Boolean(token) && token === cleanText(token); }) &&
        tokens.join(CONFIG.PASSWORD_SEPARATOR) === passwordText;

    if (!canonical || tokens.length < 2) {
        return { tokens, canonical, sortable: false, duplicateRemovable: false };
    }

    const sortedTokens = sortPasswordTokensPreservingDuplicates(tokens);
    const sortable = sortedTokens.join(CONFIG.PASSWORD_SEPARATOR) !== passwordText;
    const seen = {};
    let duplicateRemovable = false;
    for (const token of tokens) {
        const key = makePasswordCleanupKey(token);
        if (seen[key]) {
            duplicateRemovable = true;
            break;
        }
        seen[key] = true;
    }
    return { tokens, canonical, sortable, duplicateRemovable };
}

function countPasswordCleanupCandidates(sheet) {
    const lastRow = sheet.getLastRow();
    if (lastRow <= CONFIG.HEADER_ROW) return { sortableCount: 0, duplicateCount: 0 };
    const rowCount = lastRow - CONFIG.HEADER_ROW;
    const passwordRange = sheet.getRange(CONFIG.HEADER_ROW + 1, CONFIG.PASSWORD_COLUMN, rowCount, 1);
    const values = passwordRange.getDisplayValues();
    const formulas = passwordRange.getFormulas();
    let sortableCount = 0;
    let duplicateCount = 0;
    for (let index = 0; index < values.length; index += 1) {
        if (cleanText(formulas[index][0])) continue;
        const candidate = inspectPasswordCleanupCandidate(values[index][0]);
        if (candidate.sortable) sortableCount += 1;
        if (candidate.duplicateRemovable) duplicateCount += 1;
    }
    return { sortableCount, duplicateCount };
}

function cleanupPasswords(data) {
    const mode = cleanText(data && data.mode);
    const operationId = ensureOperationId(data && data.operationId);
    if (mode !== "sort" && mode !== "deduplicate") throw new Error("지원하지 않는 비밀번호 정리 방식입니다.");

    return withScriptLock(function () {
        const sheet = getTargetSheet();
        const historySheet = getHistorySheet(true);
        const duplicate = getDuplicateOperationResponse(historySheet, operationId);
        if (duplicate) return duplicate;

        const changes = collectPasswordCleanupChanges(sheet, mode);
        if (changes.length === 0) {
            return {
                success: true,
                message: mode === "sort" ? "정렬할 비밀번호가 없습니다." : "제거할 중복 비밀번호가 없습니다.",
                mode,
                changedRows: 0,
                version: getDataVersion()
            };
        }

        const safetyBackup = createBackupInternal("정리 전 자동 백업", false);
        const changeType = mode === "sort" ? "비밀번호 일괄 우선순위·호수 정렬" : "중복 비밀번호 일괄 제거";
        const restoreRows = changes.map(function (item) {
            return {
                rowId: item.rowId,
                region: item.region,
                apartment: item.apartment,
                dong: item.dong,
                line: item.line,
                value: item.beforeValue,
                expectedValue: item.afterValue
            };
        });
        const historyEntry = appendHistory(historySheet, {
            operationId,
            region: "전체",
            apartment: "관리자 자동 정리",
            dong: "",
            line: "",
            changeType,
            beforeValue: `${changes.length}개 행 정리 전`,
            afterValue: `${changes.length}개 행 정리 완료`,
            targetRow: changes.map(function (item) { return item.rowId; }).join(","),
            restoreData: JSON.stringify({ kind: "bulkRowPasswords", rows: restoreRows })
        });

        try {
            for (const item of changes) {
                setCellPlainText(sheet.getRange(item.rowId, CONFIG.PASSWORD_COLUMN), item.afterValue);
            }
            SpreadsheetApp.flush();
        } catch (error) {
            for (const item of changes) {
                try { setCellPlainText(sheet.getRange(item.rowId, CONFIG.PASSWORD_COLUMN), item.beforeValue); } catch (restoreError) {}
            }
            removeHistoryEntry(historySheet, historyEntry.rowNumber);
            throw error;
        }

        trimBackups();
        const version = bumpDataVersion();
        return {
            success: true,
            message: mode === "sort"
                ? `비밀번호 ${changes.length}개 행을 쉬운 번호 우선·호수순으로 정렬했습니다.`
                : `비밀번호 ${changes.length}개 행에서 중복을 제거했습니다.`,
            mode,
            changedRows: changes.length,
            historyId: historyEntry.historyId,
            safetyBackup,
            version
        };
    });
}

function collectPasswordCleanupChanges(sheet, mode) {
    const lastRow = sheet.getLastRow();
    if (lastRow <= CONFIG.HEADER_ROW) return [];

    const rowCount = lastRow - CONFIG.HEADER_ROW;
    const passwordRange = sheet.getRange(CONFIG.HEADER_ROW + 1, CONFIG.PASSWORD_COLUMN, rowCount, 1);
    const passwordValues = passwordRange.getDisplayValues();
    const passwordFormulas = passwordRange.getFormulas();
    const effectiveRows = getEffectiveDataRows(sheet);
    const rowInfoMap = {};
    for (const row of effectiveRows) rowInfoMap[String(row.rowId)] = row;
    const changes = [];

    for (let index = 0; index < passwordValues.length; index += 1) {
        const rowId = CONFIG.HEADER_ROW + 1 + index;
        if (cleanText(passwordFormulas[index][0])) continue;
        const beforeValue = passwordValues[index][0] === null || passwordValues[index][0] === undefined
            ? "" : String(passwordValues[index][0]);
        const candidate = inspectPasswordCleanupCandidate(beforeValue);
        if (!candidate.canonical || candidate.tokens.length < 2) continue;

        let afterTokens;
        if (mode === "sort") {
            if (!candidate.sortable) continue;
            afterTokens = sortPasswordTokensPreservingDuplicates(candidate.tokens);
        } else {
            if (!candidate.duplicateRemovable) continue;
            afterTokens = removeDuplicatePasswordTokensPreservingOrder(candidate.tokens);
        }
        const afterValue = afterTokens.join(CONFIG.PASSWORD_SEPARATOR);
        if (afterValue === beforeValue) continue;

        const rowInfo = rowInfoMap[String(rowId)] || {};
        changes.push({
            rowId,
            region: cleanText(rowInfo.region),
            apartment: cleanText(rowInfo.apartment),
            dong: cleanText(rowInfo.dong),
            line: cleanText(rowInfo.line),
            beforeValue,
            afterValue
        });
    }
    return changes;
}

function sortPasswordTokensPreservingDuplicates(values) {
    return sortPasswordEntriesByPriority(Array.isArray(values) ? values.slice() : []);
}

function makePasswordCleanupKey(value) {
    return value === null || value === undefined ? "" : String(value).toLowerCase();
}

function removeDuplicatePasswordTokensPreservingOrder(values) {
    const result = [];
    const used = {};
    for (const value of Array.isArray(values) ? values : []) {
        const key = makePasswordCleanupKey(value);
        if (used[key]) continue;
        used[key] = true;
        result.push(value);
    }
    return result;
}

function splitPasswordTokens(value) {
    const text = cleanText(value);
    if (!text) return [];
    return text.split(/\s*(?:\/|\||,|\r?\n)\s*/).map(cleanText).filter(Boolean);
}

function makeDataRowLabel(row) {
    const parts = [
        cleanText(row && row.region),
        cleanText(row && row.apartment),
        cleanText(row && row.dong),
        cleanText(row && row.line)
    ].filter(Boolean);
    return parts.join(" · ") || "행 정보";
}

function makeDataQualityCategory(key, label, allItems, severity, detailLimit) {
    const items = Array.isArray(allItems) ? allItems : [];
    return {
        key,
        label,
        severity,
        count: items.length,
        items: items.slice(0, detailLimit),
        hiddenCount: Math.max(0, items.length - detailLimit)
    };
}


function compareBackup(backupNameValue) {
    const backupName = cleanText(backupNameValue);
    if (!backupName || !isBackupSheetName(backupName)) throw new Error("비교할 백업을 찾지 못했습니다.");
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const backupSheet = spreadsheet.getSheetByName(backupName);
    if (!backupSheet || !isBackupSheetName(backupSheet.getName())) throw new Error("선택한 백업 시트를 찾지 못했습니다.");
    const targetSheet = getTargetSheet();
    const currentRows = getComparableSheetRows(targetSheet);
    const backupRows = getComparableSheetRows(backupSheet);
    const currentMap = new Map(currentRows.map(function (row) { return [row.key, row]; }));
    const backupMap = new Map(backupRows.map(function (row) { return [row.key, row]; }));
    const keys = Array.from(new Set(currentRows.map(function (row) { return row.key; }).concat(backupRows.map(function (row) { return row.key; }))));
    let added = 0;
    let removed = 0;
    let changed = 0;
    const examples = [];
    keys.forEach(function (key) {
        const current = currentMap.get(key);
        const backup = backupMap.get(key);
        if (!current && backup) {
            added += 1;
            if (examples.length < 20) examples.push({ type: "복구 시 추가", identity: backup.identity, beforeValue: "", afterValue: backup.value });
            return;
        }
        if (current && !backup) {
            removed += 1;
            if (examples.length < 20) examples.push({ type: "복구 시 삭제", identity: current.identity, beforeValue: current.value, afterValue: "" });
            return;
        }
        if (current.value !== backup.value) {
            changed += 1;
            if (examples.length < 20) examples.push({ type: "복구 시 수정", identity: current.identity, beforeValue: current.value, afterValue: backup.value });
        }
    });
    return {
        backup: getBackupInfo(backupSheet),
        currentRowCount: currentRows.length,
        backupRowCount: backupRows.length,
        added,
        removed,
        changed,
        totalChanges: added + removed + changed,
        examples,
        checkedAt: formatTimestamp(new Date())
    };
}

function getComparableSheetRows(sheet) {
    const rows = getEffectiveDataRows(sheet);
    const occurrence = {};
    return rows.map(function (row) {
        const identityBase = [row.region, row.apartment, row.dong, row.line].map(normalizeCompareText).join("\u0000");
        occurrence[identityBase] = (occurrence[identityBase] || 0) + 1;
        const key = identityBase + "\u0000" + occurrence[identityBase];
        return {
            key,
            identity: [row.region, row.apartment, row.dong, row.line].filter(Boolean).join(" · "),
            value: [cleanText(row.commonPassword), cleanText(row.password)].join("\u0001")
        };
    });
}

function calculateSheetFingerprint(sheet) {
    const rows = getComparableSheetRows(sheet);
    const text = rows.map(function (row) { return row.key + "\u0002" + row.value; }).join("\u0003");
    return { rowCount: rows.length, checksum: sha256Hex(text).slice(0, 24) };
}

function createBackup(data) {
    return withScriptLock(function () {
        const backup = createBackupInternal("수동 백업", false);
        return { success: true, message: "백업을 생성했습니다.", backup, backups: listBackups(), version: getDataVersion() };
    });
}

function restoreBackup(data) {
    const backupName = cleanText(data && data.backupName);
    if (!backupName || !isBackupSheetName(backupName)) throw new Error("복구할 백업을 찾지 못했습니다.");

    return withScriptLock(function () {
        const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
        const backupSheet = spreadsheet.getSheetByName(backupName);
        if (!backupSheet || !isBackupSheetName(backupSheet.getName())) throw new Error("선택한 백업 시트를 찾지 못했습니다.");

        const targetSheet = getTargetSheet();
        const restoredBackupInfo = getBackupInfo(backupSheet);
        const safetyBackup = createBackupInternal("복구 전 자동 백업", true);

        try {
            restoreSheetFromBackup(targetSheet, backupSheet);
            SpreadsheetApp.flush();
        } catch (error) {
            throw new Error(`백업 복구 중 오류가 발생했습니다: ${error.message}`);
        }

        trimBackups();
        const version = bumpDataVersion();
        return {
            success: true,
            message: "선택한 백업으로 복구했습니다.",
            restoredBackup: restoredBackupInfo,
            safetyBackup,
            backups: listBackups(),
            version
        };
    });
}

/* Apps Script 시간 기반 트리거에서 실행됩니다. */
function dailyAutomaticBackup() {
    try {
        const backup = withScriptLock(function () {
            return createBackupInternal("자동 백업", false);
        });
        recordAutomaticBackupSuccess(backup);
        console.log(`자동 백업 완료: ${backup.name}`);
        return backup;
    } catch (error) {
        recordAutomaticBackupFailure(error);
        console.error("자동 백업 실패:", error);
        throw error;
    }
}

function ensureDailyBackupTrigger() {
    const triggers = ScriptApp.getProjectTriggers().filter(function (trigger) {
        return trigger.getHandlerFunction() === CONFIG.AUTO_BACKUP_HANDLER;
    });

    if (triggers.length === 0) {
        setupDailyBackupTrigger();
        return getAutoBackupStatus();
    }
    if (triggers.length > 1) {
        for (let index = 1; index < triggers.length; index += 1) ScriptApp.deleteTrigger(triggers[index]);
    }
    const properties = PropertiesService.getScriptProperties();
    if (!cleanText(properties.getProperty(CONFIG.AUTO_BACKUP_SETUP_AT_PROPERTY))) {
        properties.setProperty(CONFIG.AUTO_BACKUP_SETUP_AT_PROPERTY, new Date().toISOString());
    }
    trimBackups();
    return getAutoBackupStatus();
}

function setupDailyBackupTrigger() {
    const triggers = ScriptApp.getProjectTriggers().filter(function (trigger) {
        return trigger.getHandlerFunction() === CONFIG.AUTO_BACKUP_HANDLER;
    });
    for (const trigger of triggers) ScriptApp.deleteTrigger(trigger);

    ScriptApp.newTrigger(CONFIG.AUTO_BACKUP_HANDLER)
        .timeBased()
        .atHour(CONFIG.AUTO_BACKUP_HOUR)
        .nearMinute(0)
        .everyDays(1)
        .inTimezone(CONFIG.TIME_ZONE)
        .create();

    PropertiesService.getScriptProperties().setProperty(CONFIG.AUTO_BACKUP_SETUP_AT_PROPERTY, new Date().toISOString());
    trimBackups();
    return {
        success: true,
        message: "매일 새벽 6시경 자동 백업을 설정했습니다.",
        autoBackup: getAutoBackupStatus()
    };
}

function getAutoBackupStatus() {
    const enabled = ScriptApp.getProjectTriggers().some(function (trigger) {
        return trigger.getHandlerFunction() === CONFIG.AUTO_BACKUP_HANDLER;
    });
    const properties = PropertiesService.getScriptProperties();
    const setupAtMs = parseStoredDateMs(properties.getProperty(CONFIG.AUTO_BACKUP_SETUP_AT_PROPERTY));
    let lastSuccessMs = parseStoredDateMs(properties.getProperty(CONFIG.AUTO_BACKUP_LAST_SUCCESS_PROPERTY));
    const lastFailureMs = parseStoredDateMs(properties.getProperty(CONFIG.AUTO_BACKUP_LAST_FAILURE_PROPERTY));
    const lastFailureMessage = cleanText(properties.getProperty(CONFIG.AUTO_BACKUP_LAST_FAILURE_MESSAGE_PROPERTY));

    if (!lastSuccessMs) {
        const latestAutomaticBackup = findLatestAutomaticBackupInfo();
        lastSuccessMs = latestAutomaticBackup ? parseStoredDateMs(latestAutomaticBackup.createdAt) : 0;
        if (lastSuccessMs) {
            properties.setProperty(CONFIG.AUTO_BACKUP_LAST_SUCCESS_PROPERTY, new Date(lastSuccessMs).toISOString());
        }
    }

    const now = Date.now();
    const hoursSinceSuccess = lastSuccessMs ? Math.max(0, (now - lastSuccessMs) / (60 * 60 * 1000)) : null;
    const failureAfterSuccess = Boolean(lastFailureMs && (!lastSuccessMs || lastFailureMs > lastSuccessMs));
    const waitingTooLong = Boolean(!lastSuccessMs && setupAtMs && now - setupAtMs > CONFIG.AUTO_BACKUP_STALE_HOURS * 60 * 60 * 1000);
    const stale = Boolean(lastSuccessMs && hoursSinceSuccess > CONFIG.AUTO_BACKUP_STALE_HOURS);

    let status = "healthy";
    let healthy = true;
    let needsAttention = false;
    let message = "자동 백업이 정상 작동 중입니다.";

    if (!enabled) {
        status = "setup_required";
        healthy = false;
        needsAttention = true;
        message = "자동 백업 트리거가 없습니다. 재설정이 필요합니다.";
    } else if (failureAfterSuccess) {
        status = "failed";
        healthy = false;
        needsAttention = true;
        message = `최근 자동 백업이 실패했습니다.${lastFailureMessage ? ` ${lastFailureMessage}` : ""}`;
    } else if (stale || waitingTooLong) {
        status = "stale";
        healthy = false;
        needsAttention = true;
        message = lastSuccessMs
            ? `마지막 자동 백업 후 ${Math.floor(hoursSinceSuccess)}시간이 지났습니다.`
            : "자동 백업 설정 후 30시간 이상 성공 기록이 없습니다.";
    } else if (!lastSuccessMs) {
        status = "waiting";
        healthy = true;
        message = "자동 백업이 설정되었으며 첫 실행을 기다리는 중입니다.";
    }

    return {
        enabled,
        healthy,
        needsAttention,
        status,
        schedule: "매일 06시경",
        timezone: CONFIG.TIME_ZONE,
        message,
        lastSuccessAt: lastSuccessMs ? formatTimestamp(new Date(lastSuccessMs)) : "",
        lastFailureAt: lastFailureMs ? formatTimestamp(new Date(lastFailureMs)) : "",
        lastFailureMessage,
        hoursSinceSuccess: hoursSinceSuccess === null ? null : Math.round(hoursSinceSuccess * 10) / 10
    };
}

function recordAutomaticBackupSuccess(backup) {
    const properties = PropertiesService.getScriptProperties();
    properties.setProperty(CONFIG.AUTO_BACKUP_LAST_SUCCESS_PROPERTY, new Date().toISOString());
    properties.deleteProperty(CONFIG.AUTO_BACKUP_LAST_FAILURE_PROPERTY);
    properties.deleteProperty(CONFIG.AUTO_BACKUP_LAST_FAILURE_MESSAGE_PROPERTY);
    if (backup && backup.name) console.log(`자동 백업 성공 상태 기록: ${backup.name}`);
}

function recordAutomaticBackupFailure(error) {
    const properties = PropertiesService.getScriptProperties();
    properties.setProperty(CONFIG.AUTO_BACKUP_LAST_FAILURE_PROPERTY, new Date().toISOString());
    properties.setProperty(
        CONFIG.AUTO_BACKUP_LAST_FAILURE_MESSAGE_PROPERTY,
        cleanText(error && error.message).slice(0, 500) || "알 수 없는 오류"
    );
}

function findLatestAutomaticBackupInfo() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const automaticBackups = spreadsheet.getSheets()
        .filter(function (sheet) { return sheet.getName().indexOf(`${CONFIG.BACKUP_PREFIX}자동_`) === 0; })
        .map(function (sheet) { return getBackupInfo(sheet); });
    automaticBackups.sort(function (a, b) {
        return cleanText(b.sortKey).localeCompare(cleanText(a.sortKey), "ko", { numeric: true });
    });
    return automaticBackups[0] || null;
}

function parseStoredDateMs(value) {
    const text = cleanText(value);
    if (!text) return 0;
    let normalized = text;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
        normalized = `${text.replace(" ", "T")}+09:00`;
    }
    const milliseconds = new Date(normalized).getTime();
    return Number.isFinite(milliseconds) ? milliseconds : 0;
}

function createBackupInternal(kind, skipTrim) {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sourceSheet = getTargetSheet();
    const timestamp = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, "yyyyMMdd_HHmmss");
    const normalizedKind = cleanText(kind);
    const label = normalizedKind === "복구 전 자동 백업" ? "복구전_" : normalizedKind === "자동 백업" ? "자동_" : normalizedKind === "정리 전 자동 백업" ? "정리전_" : "";
    const backupName = makeUniqueSheetName(spreadsheet, `${CONFIG.BACKUP_PREFIX}${label}${timestamp}`);
    const backupSheet = sourceSheet.copyTo(spreadsheet);
    backupSheet.setName(backupName);
    try {
        const color = normalizedKind === "복구 전 자동 백업" ? "#f6b26b" : normalizedKind === "자동 백업" ? "#6fa8dc" : normalizedKind === "정리 전 자동 백업" ? "#ffd966" : "#93c47d";
        backupSheet.setTabColor(color);
    } catch (error) {}
    try { backupSheet.hideSheet(); } catch (error) {}
    const sourceFingerprint = calculateSheetFingerprint(sourceSheet);
    const backupFingerprint = calculateSheetFingerprint(backupSheet);
    if (sourceFingerprint.rowCount !== backupFingerprint.rowCount || sourceFingerprint.checksum !== backupFingerprint.checksum) {
        try { spreadsheet.deleteSheet(backupSheet); } catch (deleteError) {}
        throw new Error("백업 검증에 실패하여 생성된 백업을 폐기했습니다.");
    }
    if (!skipTrim) trimBackups();
    const info = getBackupInfo(backupSheet, kind);
    info.fingerprint = backupFingerprint;
    info.verified = true;
    return info;
}

function restoreSheetFromBackup(targetSheet, backupSheet) {
    const sourceRange = backupSheet.getDataRange();
    const rows = sourceRange.getNumRows();
    const columns = sourceRange.getNumColumns();

    if (targetSheet.getMaxRows() < rows) targetSheet.insertRowsAfter(targetSheet.getMaxRows(), rows - targetSheet.getMaxRows());
    if (targetSheet.getMaxColumns() < columns) targetSheet.insertColumnsAfter(targetSheet.getMaxColumns(), columns - targetSheet.getMaxColumns());

    const currentLastRow = Math.max(1, targetSheet.getLastRow());
    const currentLastColumn = Math.max(CONFIG.PASSWORD_COLUMN, targetSheet.getLastColumn());
    targetSheet.getRange(1, 1, currentLastRow, currentLastColumn).clearContent();
    sourceRange.copyTo(targetSheet.getRange(1, 1, rows, columns), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
}

function listBackups() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const backups = spreadsheet.getSheets()
        .filter(function (sheet) { return isBackupSheetName(sheet.getName()); })
        .map(function (sheet) { return getBackupInfo(sheet); });

    backups.sort(function (a, b) {
        return cleanText(b.sortKey).localeCompare(cleanText(a.sortKey), "ko", { numeric: true });
    });
    return backups.slice(0, CONFIG.BACKUP_KEEP_COUNT).map(function (item) {
        return { name: item.name, createdAt: item.createdAt, rowCount: item.rowCount, kind: item.kind };
    });
}

function getBackupInfo(sheet, forcedKind) {
    const name = sheet.getName();
    const match = name.match(/(\d{8})_(\d{6})/);
    let createdAt = "";
    let sortKey = name;
    if (match) {
        const dateText = match[1];
        const timeText = match[2];
        createdAt = `${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)} ${timeText.slice(0, 2)}:${timeText.slice(2, 4)}:${timeText.slice(4, 6)}`;
        sortKey = `${dateText}${timeText}_${sheet.getSheetId()}`;
    }

    let kind = cleanText(forcedKind);
    if (!kind) {
        if (name.indexOf(`${CONFIG.BACKUP_PREFIX}복구전_`) === 0) kind = "복구 전 자동 백업";
        else if (name.indexOf(`${CONFIG.BACKUP_PREFIX}자동_`) === 0) kind = "자동 백업";
        else if (name.indexOf(`${CONFIG.BACKUP_PREFIX}정리전_`) === 0) kind = "정리 전 자동 백업";
        else kind = "수동 백업";
    }

    return {
        name,
        createdAt: createdAt || name,
        rowCount: Math.max(0, sheet.getLastRow() - CONFIG.HEADER_ROW),
        kind,
        sortKey
    };
}

function trimBackups() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = spreadsheet.getSheets().filter(function (sheet) { return isBackupSheetName(sheet.getName()); });
    sheets.sort(function (a, b) {
        return getBackupInfo(b).sortKey.localeCompare(getBackupInfo(a).sortKey, "ko", { numeric: true });
    });
    const extras = sheets.slice(CONFIG.BACKUP_KEEP_COUNT);
    for (const sheet of extras) spreadsheet.deleteSheet(sheet);
}

function isBackupSheetName(name) {
    return cleanText(name).indexOf(CONFIG.BACKUP_PREFIX) === 0;
}

function makeUniqueSheetName(spreadsheet, baseName) {
    let name = baseName.slice(0, 100);
    let suffix = 2;
    while (spreadsheet.getSheetByName(name)) {
        const tail = `_${suffix}`;
        name = `${baseName.slice(0, 100 - tail.length)}${tail}`;
        suffix += 1;
    }
    return name;
}

function getTargetSheet() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw new Error("연결된 스프레드시트를 찾을 수 없습니다.");

    const sheetName = cleanText(CONFIG.SHEET_NAME);
    if (sheetName) {
        const namedSheet = spreadsheet.getSheetByName(sheetName);
        if (!namedSheet) throw new Error(`"${sheetName}" 시트를 찾을 수 없습니다.`);
        return namedSheet;
    }

    const sheets = spreadsheet.getSheets().filter(function (sheet) {
        const name = sheet.getName();
        return name !== CONFIG.HISTORY_SHEET_NAME && name !== CONFIG.USAGE_SHEET_NAME && !isBackupSheetName(name);
    });
    if (sheets.length === 0) throw new Error("데이터 시트를 찾을 수 없습니다.");
    return sheets[0];
}

function getHistorySheet(createIfMissing) {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw new Error("연결된 스프레드시트를 찾을 수 없습니다.");

    let sheet = spreadsheet.getSheetByName(CONFIG.HISTORY_SHEET_NAME);
    if (!sheet && createIfMissing) sheet = spreadsheet.insertSheet(CONFIG.HISTORY_SHEET_NAME);
    if (!sheet) return null;
    if (sheet.getMaxColumns() < HISTORY_HEADERS.length) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), HISTORY_HEADERS.length - sheet.getMaxColumns());
    }

    const currentHeaders = sheet.getRange(1, 1, 1, HISTORY_HEADERS.length).getDisplayValues()[0];
    const needsHeader = HISTORY_HEADERS.some((header, index) => cleanText(currentHeaders[index]) !== header);

    if (needsHeader) {
        const headerRange = sheet.getRange(1, 1, 1, HISTORY_HEADERS.length);
        headerRange.setValues([HISTORY_HEADERS.slice()]);
        headerRange.setFontWeight("bold");
        headerRange.setBackground("#d9ead3");
        sheet.setFrozenRows(1);
        sheet.setColumnWidth(HC.CHANGED_AT, 145);
        sheet.setColumnWidth(HC.APARTMENT, 150);
        sheet.setColumnWidth(HC.BEFORE_VALUE, 180);
        sheet.setColumnWidth(HC.AFTER_VALUE, 180);
        sheet.hideColumns(HC.RESTORE_DATA);
    }

    return sheet;
}

function parseRowId(value) {
    const rowId = parseInt(cleanText(value), 10);
    if (!Number.isInteger(rowId)) throw new Error("올바르지 않은 행 번호입니다.");
    return rowId;
}

function validateRowId(sheet, rowId) {
    const minimumRow = CONFIG.HEADER_ROW + 1;
    const maximumRow = sheet.getLastRow();
    if (rowId < minimumRow || rowId > maximumRow) throw new Error("해당 데이터 행을 찾지 못했습니다.");
}

function setCellPlainText(cell, value) {
    cell.setNumberFormat("@");
    cell.setValue(cleanText(value));
}

function splitPasswords(value) {
    const text = cleanText(value);
    if (!text) return [];

    const result = [];
    const usedPasswords = {};

    text.split(/\s*(?:\/|\||,|\r?\n)\s*/).forEach(function (password) {
        const cleanedPassword = cleanText(password);
        if (!cleanedPassword) return;

        const normalizedPassword = normalizePassword(cleanedPassword);
        if (usedPasswords[normalizedPassword]) return;

        usedPasswords[normalizedPassword] = true;
        result.push(cleanedPassword);
    });

    return result;
}

function sortPasswords(values) {
    return sortPasswordEntriesByPriority(uniqueTextValues(Array.isArray(values) ? values : []));
}

/*
   비밀번호 정렬 규칙
   1순위: 비밀번호 숫자 부분이 3자리 이하
   2순위: 같은 숫자 반복
   3순위: 숫자 블록 반복
   4순위: 숫자 쌍 반복
   5순위: 연속 숫자
   6순위: 역순 숫자
   7순위: 앞뒤 대칭
   8순위: 호수와 비밀번호가 동일
   9순위: 지정 쉬운 번호
   일반 번호는 10순위입니다. 각 순위 안에서는 호수 오름차순으로 정렬합니다.
   한 번호가 여러 조건에 해당하면 가장 높은 순위를 적용합니다.
   숫자 묶음이 정확히 2개가 아닌 항목은 맨 뒤에서 기존 순서를 유지합니다.
*/
const EASY_PASSWORD_SPECIAL_NUMBERS = Object.freeze({
    "1004": true,
    "2580": true,
    "7942": true,
    "8282": true,
    "2424": true
});
const PASSWORD_SORT_PRIORITY = Object.freeze({
    SHORT: 1,
    SAME_DIGIT: 2,
    REPEATED_BLOCK: 3,
    REPEATED_PAIRS: 4,
    ASCENDING_SEQUENCE: 5,
    DESCENDING_SEQUENCE: 6,
    PALINDROME: 7,
    SAME_AS_ROOM: 8,
    SPECIAL: 9,
    GENERAL: 10,
    UNRECOGNIZED: 11
});

function sortPasswordEntriesByPriority(values) {
    return (Array.isArray(values) ? values : [])
        .map(function (value, index) { return analyzePasswordSortEntry(value, index); })
        .sort(comparePasswordSortEntries)
        .map(function (entry) { return entry.value; });
}

function analyzePasswordSortEntry(value, originalIndex) {
    const text = cleanText(value);
    const matches = text.match(/\d+/g) || [];
    if (matches.length !== 2) {
        return {
            value: text,
            priority: PASSWORD_SORT_PRIORITY.UNRECOGNIZED,
            roomNumber: Number.POSITIVE_INFINITY,
            originalIndex,
            easyReason: "형식 인식 불가"
        };
    }
    const roomText = matches[0];
    const passwordText = matches[1];
    const roomNumber = Number(roomText);
    const analysis = analyzeEasyPassword(roomText, passwordText);
    return {
        value: text,
        priority: analysis.priority,
        roomNumber: Number.isFinite(roomNumber) ? roomNumber : Number.POSITIVE_INFINITY,
        originalIndex,
        easyReason: analysis.reason
    };
}

function analyzeEasyPassword(roomTextValue, passwordTextValue) {
    const roomText = cleanText(roomTextValue);
    const passwordText = cleanText(passwordTextValue);
    if (!passwordText) return { easy: false, priority: PASSWORD_SORT_PRIORITY.GENERAL, reason: "" };
    const normalizedRoom = normalizeNumericText(roomText);
    const normalizedPassword = normalizeNumericText(passwordText);

    if (passwordText.length <= 3) return { easy: true, priority: PASSWORD_SORT_PRIORITY.SHORT, reason: "1순위 · 3자리 이하" };
    if (/^(\d)\1+$/.test(passwordText)) return { easy: true, priority: PASSWORD_SORT_PRIORITY.SAME_DIGIT, reason: "2순위 · 같은 숫자 반복" };
    if (hasRepeatedDigitBlock(passwordText)) return { easy: true, priority: PASSWORD_SORT_PRIORITY.REPEATED_BLOCK, reason: "3순위 · 숫자 블록 반복" };
    if (hasRepeatedDigitPairs(passwordText)) return { easy: true, priority: PASSWORD_SORT_PRIORITY.REPEATED_PAIRS, reason: "4순위 · 숫자 쌍 반복" };
    if (isAscendingDigitPattern(passwordText)) return { easy: true, priority: PASSWORD_SORT_PRIORITY.ASCENDING_SEQUENCE, reason: "5순위 · 연속 숫자" };
    if (isDescendingDigitPattern(passwordText)) return { easy: true, priority: PASSWORD_SORT_PRIORITY.DESCENDING_SEQUENCE, reason: "6순위 · 역순 숫자" };
    if (isPalindromeDigitPattern(passwordText)) return { easy: true, priority: PASSWORD_SORT_PRIORITY.PALINDROME, reason: "7순위 · 앞뒤 대칭" };
    if (normalizedRoom === normalizedPassword) return { easy: true, priority: PASSWORD_SORT_PRIORITY.SAME_AS_ROOM, reason: "8순위 · 호수와 동일" };
    if (EASY_PASSWORD_SPECIAL_NUMBERS[passwordText]) return { easy: true, priority: PASSWORD_SORT_PRIORITY.SPECIAL, reason: "9순위 · 지정 쉬운 번호" };
    return { easy: false, priority: PASSWORD_SORT_PRIORITY.GENERAL, reason: "일반 번호" };
}

function hasRepeatedDigitBlock(value) {
    const text = cleanText(value);
    const length = text.length;
    if (length < 4) return false;
    for (let blockLength = 2; blockLength <= Math.floor(length / 2); blockLength += 1) {
        if (length % blockLength !== 0) continue;
        const repeatCount = length / blockLength;
        if (repeatCount < 2) continue;
        const block = text.slice(0, blockLength);
        if (block.repeat(repeatCount) === text) return true;
    }
    return false;
}

function hasRepeatedDigitPairs(value) {
    const text = cleanText(value);
    if (text.length < 4 || text.length % 2 !== 0) return false;
    for (let index = 0; index < text.length; index += 2) {
        if (text[index] !== text[index + 1]) return false;
    }
    return true;
}

function isAscendingDigitPattern(value) { return isDirectionalDigitPattern(value, 1); }
function isDescendingDigitPattern(value) { return isDirectionalDigitPattern(value, -1); }
function isDirectionalDigitPattern(value, direction) {
    const text = cleanText(value);
    if (text.length < 4) return false;
    const digits = text.split("").map(Number);
    for (let index = 1; index < digits.length; index += 1) {
        const expected = (digits[index - 1] + direction + 10) % 10;
        if (digits[index] !== expected) return false;
    }
    return true;
}
function isSequentialDigitPattern(value) {
    return isAscendingDigitPattern(value) || isDescendingDigitPattern(value);
}
function isPalindromeDigitPattern(value) {
    const text = cleanText(value);
    return text.length >= 4 && text === text.split("").reverse().join("");
}
function comparePasswordSortEntries(left, right) {
    if (left.priority !== right.priority) return left.priority - right.priority;
    if (left.roomNumber !== right.roomNumber) return left.roomNumber - right.roomNumber;
    const textCompare = left.value.localeCompare(right.value, "ko", { numeric: true, sensitivity: "base" });
    return textCompare || left.originalIndex - right.originalIndex;
}

function normalizeNumericText(value) {
    const normalized = cleanText(value).replace(/^0+(?=\d)/, "");
    return normalized || "0";
}

function uniqueTextValues(values) {
    const result = [];
    const used = {};
    for (const value of values) {
        const text = cleanText(value);
        const key = `_${normalizePassword(text)}`;
        if (!text || used[key]) continue;
        used[key] = true;
        result.push(text);
    }
    return result;
}

function normalizePassword(value) {
    return cleanText(value).replace(/\s+/g, "").toLowerCase();
}

function normalizeCompareText(value) {
    return cleanText(value).replace(/\s+/g, "").toLowerCase();
}

function cleanText(value) {
    return value === null || value === undefined ? "" : String(value).trim();
}

function ensureOperationId(value) {
    return cleanText(value) || Utilities.getUuid();
}

function formatTimestamp(date) {
    return Utilities.formatDate(date, CONFIG.TIME_ZONE, "yyyy-MM-dd HH:mm:ss");
}

function withScriptLock(callback) {
    const lock = LockService.getScriptLock();
    const locked = lock.tryLock(CONFIG.LOCK_TIMEOUT);
    if (!locked) throw new Error("다른 사용자가 저장 중입니다. 잠시 후 다시 시도해주세요.");

    try {
        return callback();
    } finally {
        lock.releaseLock();
    }
}

function parsePostData(e) {
    if (!e || !e.postData || !e.postData.contents) throw new Error("요청 데이터가 없습니다.");

    try {
        const parsed = JSON.parse(e.postData.contents);
        if (!parsed || typeof parsed !== "object") throw new Error();
        return parsed;
    } catch (error) {
        throw new Error("요청 데이터를 읽지 못했습니다.");
    }
}

function jsonResponse(data) {
    return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(error) {
    const message = error && error.message ? error.message : "알 수 없는 오류가 발생했습니다.";
    return jsonResponse({ success: false, message });
}

function testDataQualityReport() {
    const sheet = getTargetSheet();
    const rows = getEffectiveDataRows(sheet);
    console.log(JSON.stringify(inspectDataQuality(sheet, rows), null, 2));
}

function testAutomaticBackupStatus() {
    console.log(JSON.stringify(getAutoBackupStatus(), null, 2));
}

function testGetData() {
    const data = getData();
    console.log(JSON.stringify(data.slice(0, 10), null, 2));
    console.log(`전체 데이터 수: ${data.length}`);
}

function testGetChangeHistory() {
    console.log(JSON.stringify(getChangeHistory(10), null, 2));
}

function testSetupDailyBackup() {
    console.log(JSON.stringify(setupDailyBackupTrigger(), null, 2));
}

/* ========================= 넘버원 전용 통합 코드 ========================= */
/*
 * 넘버원 전용 계정·주간 수행 통합 코드
 * - 사용자ID + 개인 PIN 계정 방식
 * - 최초 로그인 후 해당 기기에서는 장기 자동 로그인
 * - 신규 발급 시 공통 전용 PIN이 필요함
 */

const NUMBER_ONE_ADDON_CONFIG = Object.freeze({
    ACCOUNTS_SHEET_NAME: "넘버원계정",
    SESSIONS_SHEET_NAME: "넘버원세션",
    DATA_SHEET_NAME: "넘버원수행",
    ACCESS_PIN_PROPERTY: "GIMPO_B_NUMBERONE_PIN",
    SESSION_DAYS: 3650,
    ACCESS_GATE_SECONDS: 10 * 60,
    MAX_FAILURES: 5,
    LOCK_SECONDS: 10 * 60,
    TIME_ZONE: "Asia/Seoul"
});

const NUMBER_ONE_ADDON_ACCOUNT_HEADERS = Object.freeze([
    "사용자ID", "개인PIN해시", "최초등록", "최근로그인", "상태", "메모"
]);

const NUMBER_ONE_ADDON_SESSION_HEADERS = Object.freeze([
    "토큰해시", "사용자ID", "기기해시", "발급시각", "최근사용", "만료시각", "상태"
]);

const NUMBER_ONE_ADDON_DATA_HEADERS = Object.freeze([
    "사용자코드", "주시작", "작업일자", "총건수", "10~17시", "10~24시", "06~10시", "수정시간"
]);

/* ========================= 넘버원 전용 주간 수행 ========================= */
function numberOneVerifyAccessPin(data) {
    const accessPin = cleanText(data && data.accessPin);
    const clientId = cleanText(data && data.clientId);
    if (!/^\d{6}$/.test(accessPin)) throw new Error("전용 비밀번호는 숫자 6자리여야 합니다.");
    validateNumberOneClientId(clientId);

    const clientHash = sha256Hex(clientId);
    const attempt = getNumberOneAttemptKeys("ACCESS", clientHash);
    assertNumberOneNotLocked(attempt.lockKey);
    const configuredPin = cleanText(PropertiesService.getScriptProperties().getProperty(NUMBER_ONE_ADDON_CONFIG.ACCESS_PIN_PROPERTY));
    if (!/^\d{6}$/.test(configuredPin)) {
        throw new Error("넘버원 전용 비밀번호가 설정되지 않았습니다. Apps Script 스크립트 속성을 확인해주세요.");
    }
    if (!constantTimeEquals(sha256Hex(accessPin), sha256Hex(configuredPin))) {
        recordNumberOneFailure(attempt, "전용 비밀번호가 맞지 않습니다.");
    }
    clearNumberOneFailures(attempt);

    const accessToken = `${Utilities.getUuid()}_${Utilities.getUuid()}`;
    const tokenHash = sha256Hex(accessToken);
    const expiresAt = Date.now() + NUMBER_ONE_ADDON_CONFIG.ACCESS_GATE_SECONDS * 1000;
    CacheService.getScriptCache().put(
        `NUMBER_ONE_ACCESS_${tokenHash.slice(0, 40)}`,
        JSON.stringify({ clientHash, expiresAt }),
        NUMBER_ONE_ADDON_CONFIG.ACCESS_GATE_SECONDS
    );
    return { success: true, accessToken, expiresAt: new Date(expiresAt).toISOString() };
}

function requireNumberOneAccessToken(accessTokenValue, clientIdValue) {
    const accessToken = cleanText(accessTokenValue);
    const clientId = cleanText(clientIdValue);
    if (!accessToken) throw new Error("전용 안전 인증이 필요합니다.");
    validateNumberOneClientId(clientId);
    const tokenHash = sha256Hex(accessToken);
    const cacheKey = `NUMBER_ONE_ACCESS_${tokenHash.slice(0, 40)}`;
    const cache = CacheService.getScriptCache();
    const cached = cache.get(cacheKey);
    if (!cached) throw new Error("전용 안전 인증이 만료되었습니다. 전용 비밀번호를 다시 입력해주세요.");
    try {
        const parsed = JSON.parse(cached);
        if (Number(parsed.expiresAt) <= Date.now()) {
            cache.remove(cacheKey);
            throw new Error("전용 안전 인증이 만료되었습니다. 전용 비밀번호를 다시 입력해주세요.");
        }
        if (!constantTimeEquals(cleanText(parsed.clientHash), sha256Hex(clientId))) {
            throw new Error("전용 안전 인증 기기가 일치하지 않습니다.");
        }
        return true;
    } catch (error) {
        if (/전용 안전 인증/.test(cleanText(error && error.message))) throw error;
        cache.remove(cacheKey);
        throw new Error("전용 안전 인증을 확인할 수 없습니다. 전용 비밀번호를 다시 입력해주세요.");
    }
}

function numberOneRegister(data) {
    const accessToken = cleanText(data && data.accessToken);
    const personalPin = cleanText(data && data.personalPin);
    const clientId = cleanText(data && data.clientId);
    if (!/^\d{6}$/.test(personalPin)) throw new Error("개인 PIN은 숫자 6자리여야 합니다.");
    validateNumberOneClientId(clientId);
    requireNumberOneAccessToken(accessToken, clientId);

    return withScriptLock(function () {
        const accountsSheet = getNumberOneAccountsSheet(true);
        const userId = createNumberOneUserId(accountsSheet);
        const now = new Date();
        accountsSheet.appendRow([
            userId,
            createNumberOnePersonalPinCredential(personalPin),
            formatTimestamp(now),
            formatTimestamp(now),
            "사용",
            ""
        ]);
        const session = issueNumberOneSession(userId, clientId, now);
        return {
            success: true,
            issued: true,
            userId,
            token: session.token,
            expiresAt: session.expiresAt,
            data: buildNumberOneDashboardPayload(userId)
        };
    });
}

function numberOneAccountLogin(data) {
    const accessToken = cleanText(data && data.accessToken);
    const userId = normalizeNumberOneUserId(data && data.userId);
    const personalPin = cleanText(data && data.personalPin);
    const clientId = cleanText(data && data.clientId);
    if (!userId) throw new Error("사용자ID를 확인해주세요.");
    if (!/^\d{6}$/.test(personalPin)) throw new Error("개인 PIN은 숫자 6자리여야 합니다.");
    validateNumberOneClientId(clientId);
    requireNumberOneAccessToken(accessToken, clientId);

    const clientHash = sha256Hex(clientId);
    const attempt = getNumberOneAttemptKeys("LOGIN", `${clientHash}_${userId}`);
    assertNumberOneNotLocked(attempt.lockKey);
    const sheet = getNumberOneAccountsSheet(false);
    const account = findNumberOneAccountByUserId(sheet, userId);
    const valid = account && normalizeCompareText(account.status) === "사용" && verifyNumberOnePersonalPin(personalPin, account.pinCredential);
    if (!valid) recordNumberOneFailure(attempt, "사용자ID 또는 개인 PIN이 맞지 않습니다.");
    clearNumberOneFailures(attempt);

    return withScriptLock(function () {
        const lockedSheet = getNumberOneAccountsSheet(false);
        const current = findNumberOneAccountByUserId(lockedSheet, userId);
        if (!current || normalizeCompareText(current.status) !== "사용") throw new Error("사용할 수 없는 계정입니다.");
        const now = new Date();
        lockedSheet.getRange(current.rowNumber, 4).setValue(formatTimestamp(now));
        const session = issueNumberOneSession(userId, clientId, now);
        return {
            success: true,
            userId,
            token: session.token,
            expiresAt: session.expiresAt,
            data: buildNumberOneDashboardPayload(userId)
        };
    });
}

function numberOneLogout(data) {
    const token = cleanText(data && data.token);
    if (!token) return { success: true };
    const tokenHash = sha256Hex(token);
    return withScriptLock(function () {
        const sheet = getNumberOneSessionsSheet(false);
        if (sheet && sheet.getLastRow() >= 2) {
            const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, NUMBER_ONE_ADDON_SESSION_HEADERS.length).getDisplayValues();
            for (let index = rows.length - 1; index >= 0; index -= 1) {
                if (!constantTimeEquals(cleanText(rows[index][0]), tokenHash)) continue;
                sheet.getRange(index + 2, 7).setValue("로그아웃");
                break;
            }
        }
        CacheService.getScriptCache().remove(`NUMBER_ONE_TOKEN_${tokenHash.slice(0, 40)}`);
        return { success: true };
    });
}

function numberOneGetWeek(data) {
    const auth = requireNumberOneToken(data && data.token);
    return { success: true, data: buildNumberOneDashboardPayload(auth.userCode) };
}

function numberOneSaveDay(data) {
    const auth = requireNumberOneToken(data && data.token);
    const workDate = validateNumberOneDateKey(data && data.workDate, "작업일자");
    const values = data && typeof data.values === "object" && data.values ? data.values : {};
    return withScriptLock(function () {
        const sheet = getNumberOneDataSheet(true);
        const rowNumber = findNumberOneDataRow(sheet, auth.userCode, workDate);
        const current = rowNumber ? readNumberOneDataRow(sheet, rowNumber) : {
            totalCount: null,
            tenToSeventeen: null,
            tenToTwentyFour: null,
            sixToTen: null
        };
        const merged = {
            totalCount: mergeNumberOneCount(current.totalCount, values, "totalCount", "총건수"),
            tenToSeventeen: mergeNumberOneCount(current.tenToSeventeen, values, "tenToSeventeen", "10~17시"),
            tenToTwentyFour: mergeNumberOneCount(current.tenToTwentyFour, values, "tenToTwentyFour", "10~24시"),
            sixToTen: 0
        };
        if ([merged.totalCount, merged.tenToSeventeen, merged.tenToTwentyFour, merged.sixToTen].every(function (value) { return value === null; })) {
            throw new Error("저장할 수행 건수를 입력해주세요.");
        }
        validateNumberOneCounts(merged);
        const weekStart = getNumberOneWeekStart(workDate);
        const updatedAt = formatTimestamp(new Date());
        const row = [
            auth.userCode,
            weekStart,
            workDate,
            numberOneCellValue(merged.totalCount),
            numberOneCellValue(merged.tenToSeventeen),
            numberOneCellValue(merged.tenToTwentyFour),
            numberOneCellValue(merged.sixToTen),
            updatedAt
        ];
        if (rowNumber) sheet.getRange(rowNumber, 1, 1, NUMBER_ONE_ADDON_DATA_HEADERS.length).setValues([row]);
        else sheet.appendRow(row);
        return { success: true, workDate, updatedAt };
    });
}

function numberOneDeleteDay(data) {
    const auth = requireNumberOneToken(data && data.token);
    const workDate = validateNumberOneDateKey(data && data.workDate, "작업일자");
    return withScriptLock(function () {
        const sheet = getNumberOneDataSheet(false);
        let deletedRows = 0;
        if (sheet && sheet.getLastRow() >= 2) {
            const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getDisplayValues();
            for (let index = rows.length - 1; index >= 0; index -= 1) {
                if (cleanText(rows[index][0]) !== auth.userCode || cleanText(rows[index][2]) !== workDate) continue;
                sheet.deleteRow(index + 2);
                deletedRows += 1;
            }
        }
        return { success: true, workDate, deletedRows };
    });
}

function requireNumberOneToken(tokenValue) {
    const token = cleanText(tokenValue);
    if (!token) throw new Error("넘버원 전용 로그인이 필요합니다.");
    const tokenHash = sha256Hex(token);
    const cache = CacheService.getScriptCache();
    const cacheKey = `NUMBER_ONE_TOKEN_${tokenHash.slice(0, 40)}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (parsed.userCode && Number(parsed.expiresAt) > Date.now()) return parsed;
        } catch (error) {}
        cache.remove(cacheKey);
    }

    const sheet = getNumberOneSessionsSheet(false);
    if (!sheet || sheet.getLastRow() < 2) throw new Error("넘버원 전용 로그인이 만료되었습니다.");
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, NUMBER_ONE_ADDON_SESSION_HEADERS.length).getDisplayValues();
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        const row = rows[index];
        if (!constantTimeEquals(cleanText(row[0]), tokenHash)) continue;
        if (normalizeCompareText(row[6]) !== "사용") throw new Error("넘버원 전용 로그인이 해제되었습니다.");
        const expiresAt = new Date(row[5]).getTime();
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("넘버원 전용 로그인이 만료되었습니다.");
        const userId = normalizeNumberOneUserId(row[1]);
        const account = findNumberOneAccountByUserId(getNumberOneAccountsSheet(false), userId);
        if (!account || normalizeCompareText(account.status) !== "사용") throw new Error("사용할 수 없는 계정입니다.");
        const auth = { userCode: userId, expiresAt };
        cacheNumberOneToken(tokenHash, auth.userCode, expiresAt);
        return auth;
    }
    throw new Error("넘버원 전용 로그인이 만료되었습니다.");
}

function cacheNumberOneToken(tokenHash, userCode, expiresAt) {
    const seconds = Math.max(60, Math.min(21600, Math.floor((expiresAt - Date.now()) / 1000)));
    if (seconds <= 0) return;
    CacheService.getScriptCache().put(
        `NUMBER_ONE_TOKEN_${cleanText(tokenHash).slice(0, 40)}`,
        JSON.stringify({ userCode, expiresAt }),
        seconds
    );
}

function getNumberOneAccountsSheet(createIfMissing) {
    return getNumberOneManagedSheet(NUMBER_ONE_ADDON_CONFIG.ACCOUNTS_SHEET_NAME, NUMBER_ONE_ADDON_ACCOUNT_HEADERS, createIfMissing, "#d9eaf7");
}

function getNumberOneSessionsSheet(createIfMissing) {
    return getNumberOneManagedSheet(NUMBER_ONE_ADDON_CONFIG.SESSIONS_SHEET_NAME, NUMBER_ONE_ADDON_SESSION_HEADERS, createIfMissing, "#e2f0d9");
}

function getNumberOneDataSheet(createIfMissing) {
    return getNumberOneManagedSheet(NUMBER_ONE_ADDON_CONFIG.DATA_SHEET_NAME, NUMBER_ONE_ADDON_DATA_HEADERS, createIfMissing, "#fff2cc");
}

function getNumberOneManagedSheet(name, headers, createIfMissing, headerColor) {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet && createIfMissing) sheet = spreadsheet.insertSheet(name);
    if (!sheet) return null;
    if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    const needsHeader = headers.some(function (header, index) { return cleanText(current[index]) !== header; });
    if (needsHeader) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers.slice()]).setFontWeight("bold").setBackground(headerColor);
        sheet.setFrozenRows(1);
    }
    try { sheet.hideSheet(); } catch (error) {}
    return sheet;
}

function validateNumberOneClientId(clientId) {
    if (clientId.length < 12 || clientId.length > 180) throw new Error("기기 식별값이 올바르지 않습니다.");
}

function normalizeNumberOneUserId(value) {
    let text = cleanText(value).toUpperCase().replace(/\s+/g, "");
    if (/^[A-Z0-9]{6}$/.test(text)) text = `NO-${text}`;
    return /^NO-[A-Z0-9]{6}$/.test(text) ? text : "";
}

function createNumberOneUserId(sheet) {
    const used = {};
    if (sheet && sheet.getLastRow() >= 2) {
        sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().forEach(function (row) {
            used[normalizeNumberOneUserId(row[0])] = true;
        });
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const code = `NO-${Utilities.getUuid().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
        if (!used[code]) return code;
    }
    return `NO-${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

function createNumberOnePersonalPinCredential(pin) {
    const salt = Utilities.getUuid().replace(/-/g, "");
    return `${salt}$${sha256Hex(`${salt}:${pin}`)}`;
}

function verifyNumberOnePersonalPin(pin, credential) {
    const parts = cleanText(credential).split("$");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
    return constantTimeEquals(sha256Hex(`${parts[0]}:${pin}`), parts[1]);
}

function findNumberOneAccountByUserId(sheet, userIdValue) {
    const userId = normalizeNumberOneUserId(userIdValue);
    if (!sheet || !userId || sheet.getLastRow() < 2) return null;
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, NUMBER_ONE_ADDON_ACCOUNT_HEADERS.length).getDisplayValues();
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        const row = rows[index];
        if (normalizeNumberOneUserId(row[0]) !== userId) continue;
        return {
            rowNumber: index + 2,
            userId,
            pinCredential: cleanText(row[1]),
            createdAt: cleanText(row[2]),
            lastLoginAt: cleanText(row[3]),
            status: cleanText(row[4])
        };
    }
    return null;
}

function issueNumberOneSession(userId, clientId, nowValue) {
    const sheet = getNumberOneSessionsSheet(true);
    const now = nowValue instanceof Date ? nowValue : new Date();
    const clientHash = sha256Hex(clientId);
    const token = `${Utilities.getUuid()}_${Utilities.getUuid()}`;
    const tokenHash = sha256Hex(token);
    const expiresAtDate = new Date(now.getTime() + NUMBER_ONE_ADDON_CONFIG.SESSION_DAYS * 24 * 60 * 60 * 1000);
    const row = [
        tokenHash,
        userId,
        clientHash,
        formatTimestamp(now),
        formatTimestamp(now),
        expiresAtDate.toISOString(),
        "사용"
    ];
    let rowNumber = 0;
    if (sheet.getLastRow() >= 2) {
        const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, NUMBER_ONE_ADDON_SESSION_HEADERS.length).getDisplayValues();
        for (let index = rows.length - 1; index >= 0; index -= 1) {
            if (normalizeNumberOneUserId(rows[index][1]) === userId && constantTimeEquals(cleanText(rows[index][2]), clientHash)) {
                rowNumber = index + 2;
                break;
            }
        }
    }
    if (rowNumber) sheet.getRange(rowNumber, 1, 1, NUMBER_ONE_ADDON_SESSION_HEADERS.length).setValues([row]);
    else sheet.appendRow(row);
    cacheNumberOneToken(tokenHash, userId, expiresAtDate.getTime());
    return { token, expiresAt: expiresAtDate.toISOString() };
}

function getNumberOneAttemptKeys(scope, rawKey) {
    const key = sha256Hex(cleanText(rawKey)).slice(0, 32);
    return {
        failureKey: `NUMBER_ONE_${scope}_FAIL_${key}`,
        lockKey: `NUMBER_ONE_${scope}_LOCK_${key}`
    };
}

function assertNumberOneNotLocked(lockKey) {
    if (CacheService.getScriptCache().get(lockKey)) throw new Error("인증 오류가 여러 번 발생했습니다. 10분 후 다시 시도해주세요.");
}

function recordNumberOneFailure(keys, baseMessage) {
    const cache = CacheService.getScriptCache();
    const failures = (Number(cache.get(keys.failureKey)) || 0) + 1;
    if (failures >= NUMBER_ONE_ADDON_CONFIG.MAX_FAILURES) {
        cache.remove(keys.failureKey);
        cache.put(keys.lockKey, "1", NUMBER_ONE_ADDON_CONFIG.LOCK_SECONDS);
        throw new Error(`${baseMessage} 10분 동안 인증이 잠겼습니다.`);
    }
    cache.put(keys.failureKey, String(failures), NUMBER_ONE_ADDON_CONFIG.LOCK_SECONDS);
    throw new Error(`${baseMessage} ${NUMBER_ONE_ADDON_CONFIG.MAX_FAILURES - failures}회 남았습니다.`);
}

function clearNumberOneFailures(keys) {
    const cache = CacheService.getScriptCache();
    cache.remove(keys.failureKey);
    cache.remove(keys.lockKey);
}

function findNumberOneDataRow(sheet, userCode, workDate) {
    if (!sheet || sheet.getLastRow() < 2) return 0;
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getDisplayValues();
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (cleanText(rows[index][0]) === userCode && cleanText(rows[index][2]) === workDate) return index + 2;
    }
    return 0;
}

function readNumberOneDataRow(sheet, rowNumber) {
    const row = sheet.getRange(rowNumber, 1, 1, NUMBER_ONE_ADDON_DATA_HEADERS.length).getDisplayValues()[0];
    return {
        userCode: cleanText(row[0]),
        weekStart: cleanText(row[1]),
        workDate: cleanText(row[2]),
        totalCount: parseStoredNumberOneCount(row[3]),
        tenToSeventeen: parseStoredNumberOneCount(row[4]),
        tenToTwentyFour: parseStoredNumberOneCount(row[5]),
        sixToTen: parseStoredNumberOneCount(row[6]),
        updatedAt: cleanText(row[7])
    };
}

function buildNumberOneDashboardPayload(userCode) {
    const current = buildNumberOneWeekPayload(userCode);
    const previousWeekStart = addNumberOneDays(current.context.weekStart, -7);
    current.previousWeek = buildNumberOneWeekPayload(userCode, previousWeekStart);
    return current;
}

function buildNumberOneWeekPayload(userCode, requestedWeekStart) {
    const context = getNumberOneCurrentContext();
    const weekStart = requestedWeekStart ? validateNumberOneDateKey(requestedWeekStart, "주시작") : context.weekStart;
    const weekEnd = addNumberOneDays(weekStart, 7);
    const sheet = getNumberOneDataSheet(false);
    const days = [];
    if (sheet && sheet.getLastRow() >= 2) {
        const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, NUMBER_ONE_ADDON_DATA_HEADERS.length).getDisplayValues();
        for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index];
            if (cleanText(row[0]) !== userCode || cleanText(row[1]) !== weekStart) continue;
            days.push({
                workDate: cleanText(row[2]),
                totalCount: parseStoredNumberOneCount(row[3]),
                tenToSeventeen: parseStoredNumberOneCount(row[4]),
                tenToTwentyFour: parseStoredNumberOneCount(row[5]),
                sixToTen: parseStoredNumberOneCount(row[6]),
                updatedAt: cleanText(row[7])
            });
        }
    }
    days.sort(function (a, b) { return a.workDate.localeCompare(b.workDate); });
    return {
        userCode,
        context: {
            weekStart,
            weekEnd,
            currentWorkDate: context.currentWorkDate,
            currentWeekStart: context.weekStart,
            checkedAt: formatTimestamp(new Date())
        },
        days,
        summary: calculateNumberOneSummary(days)
    };
}

function calculateNumberOneSummary(days) {
    const sorted = (Array.isArray(days) ? days.slice() : []).sort(function (a, b) { return a.workDate.localeCompare(b.workDate); });
    let totalCount = 0;
    let tenToSeventeenCount = 0;
    let tenToTwentyFourCount = 0;

    sorted.forEach(function (day) {
        totalCount += Math.max(0, Number(day.totalCount) || 0);
        tenToSeventeenCount += Math.max(0, Number(day.tenToSeventeen) || 0);
        tenToTwentyFourCount += Math.max(0, Number(day.tenToTwentyFour) || 0);
    });

    tenToTwentyFourCount = Math.min(totalCount, tenToTwentyFourCount);
    const otherTimeCount = Math.max(0, totalCount - tenToTwentyFourCount);
    const additionalCount = Math.max(0, totalCount - 150);
    const premiumQualified = totalCount >= 250 && tenToSeventeenCount >= 100;

    // 상향 조건 충족 시 151번째 이후 물량에서 기타시간(06~10 + 00~05)을 먼저 1,000원으로 계산하고,
    // 나머지 10~24시 물량에 500원을 추가해 건당 1,500원으로 계산한다.
    const standardEligibleCount = premiumQualified
        ? Math.min(additionalCount, otherTimeCount)
        : additionalCount;
    const premiumEligibleCount = premiumQualified
        ? Math.max(0, additionalCount - standardEligibleCount)
        : 0;

    const baseBonus = additionalCount * 1000;
    const premiumBonus = premiumEligibleCount * 500;
    return {
        totalCount,
        tenToSeventeenCount,
        tenToTwentyFourCount,
        otherTimeCount,
        additionalCount,
        standardEligibleCount,
        premiumEligibleCount,
        baseBonus,
        premiumBonus,
        totalBonus: baseBonus + premiumBonus,
        premiumQualified,
        bonusExact: true,
        hasMissingTotal: false,
        crossingWorkDate: "",
        needsSixToTen: false
    };
}

function getNumberOneCurrentContext() {
    const shifted = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const currentWorkDate = Utilities.formatDate(shifted, NUMBER_ONE_ADDON_CONFIG.TIME_ZONE, "yyyy-MM-dd");
    const weekStart = getNumberOneWeekStart(currentWorkDate);
    return { currentWorkDate, weekStart, weekEnd: addNumberOneDays(weekStart, 7) };
}

function getNumberOneWeekStart(workDate) {
    const dateKey = validateNumberOneDateKey(workDate, "작업일자");
    const date = new Date(`${dateKey}T00:00:00Z`);
    const daysSinceWednesday = (date.getUTCDay() - 3 + 7) % 7;
    date.setUTCDate(date.getUTCDate() - daysSinceWednesday);
    return date.toISOString().slice(0, 10);
}

function addNumberOneDays(dateKey, days) {
    const date = new Date(`${validateNumberOneDateKey(dateKey, "날짜")}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
}

function validateNumberOneDateKey(value, label) {
    const text = cleanText(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label || "날짜"} 형식이 올바르지 않습니다.`);
    const date = new Date(`${text}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error(`${label || "날짜"}가 올바르지 않습니다.`);
    return text;
}

function mergeNumberOneCount(currentValue, values, key, label) {
    if (!Object.prototype.hasOwnProperty.call(values, key) || values[key] === null || values[key] === "") return currentValue;
    return parseNumberOneCount(values[key], label);
}

function parseNumberOneCount(value, label) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 999) throw new Error(`${label}는 0~999 사이의 정수로 입력해주세요.`);
    return number;
}

function parseStoredNumberOneCount(value) {
    const text = cleanText(value);
    if (text === "") return null;
    const number = Number(text);
    return Number.isInteger(number) && number >= 0 ? number : null;
}

function numberOneCellValue(value) {
    return value === null ? "" : value;
}

function validateNumberOneCounts(values) {
    if (values.tenToSeventeen !== null && values.tenToTwentyFour !== null && values.tenToSeventeen > values.tenToTwentyFour) {
        throw new Error("10~17시 건수는 10~24시 건수보다 클 수 없습니다.");
    }
    if (values.totalCount !== null && values.tenToTwentyFour !== null && values.tenToTwentyFour > values.totalCount) {
        throw new Error("10~17시와 17~24시 합계는 총건수보다 클 수 없습니다.");
    }
    if (values.totalCount !== null && values.tenToSeventeen !== null && values.tenToSeventeen > values.totalCount) {
        throw new Error("10~17시 건수는 총건수보다 클 수 없습니다.");
    }
}
