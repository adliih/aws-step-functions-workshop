/** @param {{ "data": number[] }} event */
exports.handler = async (event) => {
  console.log(event);

  const { data } = event;

  return {
    sum: data.reduce((prev, curr) => prev + curr, 0),
  };
};
