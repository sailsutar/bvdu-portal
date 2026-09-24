import { Platform, Alert } from "react-native";
import Constants from "expo-constants";
import { api } from "./api";

/** EAS project id for @sahil4654/bvu-parent */
const EAS_PROJECT_ID = "cfc18934-61cd-4bea-9c74-f6414a298a3a";

export function isExpoGo() {
  return (
    Constants.appOwnership === "expo" ||
    Constants.executionEnvironment === "storeClient"
  );
}

let Notifications = null;
let moduleLoadFailed = false;

function loadNotificationsModule() {
  if (Notifications) return true;
  if (moduleLoadFailed) return false;
  try {
    Notifications = require("expo-notifications");
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    return true;
  } catch (e) {
    moduleLoadFailed = true;
    console.warn("expo-notifications unavailable:", e?.message);
    return false;
  }
}

function getProjectId() {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ||
    Constants.easConfig?.projectId ||
    EAS_PROJECT_ID
  );
}

export async function ensureNotificationPermissions() {
  if (!loadNotificationsModule()) {
    return { granted: false, reason: "module-missing" };
  }
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    return { granted: finalStatus === "granted", status: finalStatus };
  } catch (e) {
    return { granted: false, reason: e.message };
  }
}

/**
 * Get Expo push token and POST to backend.
 * Must run on a real APK (not Expo Go).
 */
export async function registerForPushAsync() {
  if (isExpoGo()) {
    return {
      ok: false,
      expoGoLimited: true,
      remotePush: false,
      error: "Expo Go cannot register remote push. Use the BVU Parent APK.",
    };
  }

  if (!loadNotificationsModule()) {
    return { ok: false, error: "Notifications module not available" };
  }

  const perm = await ensureNotificationPermissions();
  if (!perm.granted) {
    return {
      ok: false,
      error: "Notification permission not granted. Enable in Android Settings → BVU Parent → Notifications.",
      permission: perm,
    };
  }

  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("bvu-parent", {
        name: "BVU Parent",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#F5C542",
        sound: "default",
      });
    }
  } catch (_) {}

  let expoPushToken = null;
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: getProjectId(),
    });
    expoPushToken = tokenData?.data || null;
  } catch (e) {
    return {
      ok: false,
      error: e.message || "Could not get Expo push token (check FCM on Expo credentials)",
      permission: perm,
      projectId: getProjectId(),
    };
  }

  if (!expoPushToken || typeof expoPushToken !== "string") {
    return { ok: false, error: "Empty Expo push token", permission: perm };
  }

  try {
    await api("/api/parent/push-token", {
      method: "POST",
      body: JSON.stringify({ token: expoPushToken, expoPushToken }),
    });
  } catch (e) {
    return {
      ok: false,
      error: `Token register failed: ${e.message || "network/API error"}`,
      expoPushToken,
      permission: perm,
    };
  }

  return {
    ok: true,
    expoPushToken,
    permission: perm,
    remotePush: true,
    projectId: getProjectId(),
  };
}

export async function showLocalDemoNotification({
  title = "BVU Parent",
  body = "Attendance and marks are available for your child.",
  data = {},
  showAlertFallback = true,
} = {}) {
  let scheduled = false;
  let scheduleError = null;

  if (loadNotificationsModule()) {
    try {
      const perm = await ensureNotificationPermissions();
      if (perm.granted) {
        try {
          if (Platform.OS === "android") {
            await Notifications.setNotificationChannelAsync("bvu-parent", {
              name: "BVU Parent",
              importance: Notifications.AndroidImportance.MAX,
              sound: "default",
            });
          }
        } catch (_) {}
        await Notifications.scheduleNotificationAsync({
          content: {
            title,
            body,
            data,
            sound: true,
            ...(Platform.OS === "android" ? { channelId: "bvu-parent" } : {}),
          },
          trigger: null,
        });
        scheduled = true;
      } else {
        scheduleError = "permission-denied";
      }
    } catch (e) {
      scheduleError = e.message || "schedule-failed";
    }
  } else {
    scheduleError = "module-unavailable";
  }

  if (showAlertFallback) {
    setTimeout(() => {
      Alert.alert(title, body, [{ text: "OK" }]);
    }, 200);
  }

  return { ok: true, scheduled, scheduleError, expoGo: isExpoGo() };
}
