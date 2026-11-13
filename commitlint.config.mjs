import { messageProblems, SCOPES, TYPES } from './scripts/changelog.mjs';

const broteamMessage = (parsed) => {
  const problem = messageProblems(parsed.header, parsed.body);
  return problem ? [false, problem] : [true];
};

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [{ rules: { 'broteam-message': broteamMessage } }],
  rules: {
    'broteam-message': [2, 'always'],
    'scope-enum': [2, 'always', [...SCOPES, 'release']],
    'type-enum': [2, 'always', [...TYPES, 'build']],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'body-leading-blank': [2, 'always'],
    'subject-full-stop': [2, 'never'],
  },
};
