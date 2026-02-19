import { initDB } from "@/database";
import { initLanguage } from "@/locales";
import { Redirect } from "expo-router";
import { useEffect } from "react";

export default function Index() {
  useEffect(() => {
    initLanguage();
    initDB();
  }, []);

  return <Redirect href="/(tabs)/home" />;
}
