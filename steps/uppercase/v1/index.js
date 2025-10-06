module.exports = async ({ inputs, log }) => {
  const text = inputs.text ?? '';
  const result = String(text).toUpperCase();
  log('Converted to uppercase', { text: result });
  return { outputs: { text: result } };
};
