import { Redirect } from "expo-router";
import { useEffect } from "react";
import { initDB } from "../database";
import { initLanguage } from "../locales";

export default function Index() {
  useEffect(() => {
    initLanguage();
    initDB();
  }, []);

  return <Redirect href="/(tabs)/home" />;
}
