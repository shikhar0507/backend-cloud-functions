'use strict';


module.exports = (change) => {
  const {
    report,
  } = change.after.data();

  if (report === 'added') return require('./sign-up-report')(change);

  if (report === 'install') return require('./install-report')(change);

  return Promise.resolve();
};
