// Guard against node environment where @testing-library/react may not be fully functional
if (typeof document !== "undefined") {
  const { configure } = await import("@testing-library/react");
  configure({ asyncUtilTimeout: 10_000 });
}

export {};
