"use client";

import { getEngine } from "@/engine";
import { Screen } from "@/screen/Screen";

export default function Home() {
  return <Screen engine={getEngine} />;
}
