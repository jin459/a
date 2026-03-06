interface A {
  site: string
}

function aa(a: A) {
  console.info(a)
}

const a = {
  site: "a",
  id: 111
}

aa(a)
