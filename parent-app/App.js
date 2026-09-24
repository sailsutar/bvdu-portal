import { useEffect, useRef, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Text, View } from "react-native";
import Constants from "expo-constants";
import LoginScreen from "./src/screens/LoginScreen";
import HomeScreen from "./src/screens/HomeScreen";
import ChildScreen from "./src/screens/ChildScreen";
import NoticesScreen from "./src/screens/NoticesScreen";
import { getToken } from "./src/lib/api";

const isExpoGo = Constants.appOwnership === "expo";
let Notifications = null;
if (!isExpoGo) {
  try {
    Notifications = require("expo-notifications");
  } catch (_) {
    Notifications = null;
  }
}

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: "#0B1F3A" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "700" },
        tabBarActiveTintColor: "#0B1F3A",
        tabBarStyle: { paddingBottom: 4, height: 56 },
      }}
    >
      <Tab.Screen
        name="Children"
        component={HomeScreen}
        options={{
          title: "My children",
          tabBarLabel: "Children",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 16 }}>👨‍👩‍👧</Text>,
        }}
      />
      <Tab.Screen
        name="NoticesTab"
        component={NoticesScreen}
        options={{
          title: "Notices",
          tabBarLabel: "Notices",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 16 }}>🔔</Text>,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [boot, setBoot] = useState(true);
  const [authed, setAuthed] = useState(false);
  const navRef = useRef(null);

  useEffect(() => {
    (async () => {
      const t = await getToken();
      setAuthed(Boolean(t));
      setBoot(false);
    })();
  }, []);

  useEffect(() => {
    if (!Notifications?.addNotificationResponseReceivedListener) return undefined;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const screen = response?.notification?.request?.content?.data?.screen;
      if (screen === "Notices" && navRef.current) {
        navRef.current.navigate("Main", { screen: "NoticesTab" });
      }
    });
    return () => sub.remove();
  }, []);

  if (boot) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color="#0B1F3A" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navRef}>
      <StatusBar style="light" />
      <Stack.Navigator
        initialRouteName={authed ? "Main" : "Login"}
        screenOptions={{
          headerStyle: { backgroundColor: "#0B1F3A" },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "700" },
        }}
      >
        <Stack.Screen name="Login" options={{ headerShown: false }}>
          {(props) => (
            <LoginScreen
              {...props}
              onLoggedIn={() => {
                setAuthed(true);
                props.navigation.replace("Main");
              }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen
          name="Child"
          component={ChildScreen}
          options={({ route }) => ({ title: route.params?.name || "Student" })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
