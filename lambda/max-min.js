exports.handler = async (event) => {
  console.log(event);
  return {
    max: Math.max(event["data"]),
    min: Math.min(event["data"]),
  };
};
