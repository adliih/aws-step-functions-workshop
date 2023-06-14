/** @param {{ "data": number[] }} event */
exports.handler = async (event) => {
  console.log(event);

  const { data } = event;

  return {
    avg: data.reduce((prev, curr) => prev + curr, 0) / data.length,
  };
};
