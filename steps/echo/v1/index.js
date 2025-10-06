module.exports = async ({ inputs, log }) => {
  const text = inputs.text ?? '';
  log('Echoing input', { text });
  return { outputs: { text: String(text) } };
};
