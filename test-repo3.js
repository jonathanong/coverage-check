const regex = /^[A-Za-z0-9_.][A-Za-z0-9_.-]*\/[A-Za-z0-9_.][A-Za-z0-9_.-]*$/;
console.log(regex.test("owner/repo"));
console.log(regex.test("-owner/repo"));
