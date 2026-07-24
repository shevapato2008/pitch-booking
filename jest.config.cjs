module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/?(*.)+(spec|test).[tj]s"],
  testPathIgnorePatterns: ["/dist/"],
  modulePathIgnorePatterns: ["<rootDir>/.worktrees/"],
};
