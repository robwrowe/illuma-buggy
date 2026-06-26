import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { enableScreens } from 'react-native-screens';

enableScreens();

// Import icons from individual paths instead of barrel export
import IconHome from '@tabler/icons-react-native/dist/esm/icons/IconHome';
import IconBluetooth from '@tabler/icons-react-native/dist/esm/icons/IconBluetooth';

const Tab = createBottomTabNavigator();

function TestScreen() {
  return (
    <View style={styles.container}>
      <IconBluetooth size={32} color="#a78bfa" />
      <Text style={styles.text}>Icons OK</Text>
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <NavigationContainer>
          <Tab.Navigator>
            <Tab.Screen name="Test" component={TestScreen}
              options={{ tabBarIcon: ({ color, size }) => <IconHome size={size} color={color} /> }} />
          </Tab.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f', alignItems: 'center', justifyContent: 'center', gap: 12 },
  text: { color: '#fff', fontSize: 16 },
});
