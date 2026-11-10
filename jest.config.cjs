// jest.config.cjs
module.exports = {
  preset: 'react-native',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.(js|ts|tsx)$': 'babel-jest'
  },
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|react-native-safe-area-context|@react-native(-community)?|@react-navigation)/)'
  ],
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  testEnvironment: 'node',
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json'
    }
  }
};
