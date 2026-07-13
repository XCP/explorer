import { createReadStream } from "node:fs";

export async function* readSqlStatements(path) {
  const stream = createReadStream(path, { encoding: "utf8" });
  let statement = "";
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  let previous = "";
  let carry = "";

  for await (const sourceChunk of stream) {
    const chunk = carry + sourceChunk;
    let index = 0;
    while (index < chunk.length - 1) {
      const character = chunk[index];
      const next = chunk[index + 1];
      statement += character;

      if (lineComment) {
        if (character === "\n") lineComment = false;
        previous = character;
        index++;
        continue;
      }
      if (blockComment) {
        if (previous === "*" && character === "/") blockComment = false;
        previous = character;
        index++;
        continue;
      }
      if (quote) {
        if (character === quote) {
          if (next === quote) {
            statement += next;
            index += 2;
          } else {
            quote = null;
            index++;
          }
        } else index++;
        previous = character;
        continue;
      }
      if (character === "-" && next === "-") {
        statement += next;
        index += 2;
        lineComment = true;
      } else if (character === "/" && next === "*") {
        statement += next;
        index += 2;
        blockComment = true;
      } else if (character === "'" || character === '"' || character === "`") {
        quote = character;
        index++;
      } else if (character === ";") {
        if (statement.trim()) yield statement;
        statement = "";
        index++;
      } else index++;
      previous = character;
    }
    carry = chunk.slice(index);
  }
  if (carry) {
    statement += carry;
    if (lineComment && carry === "\n") lineComment = false;
    else if (blockComment && previous === "*" && carry === "/") blockComment = false;
    else if (quote && carry === quote) quote = null;
    else if (!lineComment && !blockComment && !quote && carry === ";") {
      if (statement.trim()) yield statement;
      statement = "";
    } else if (!lineComment && !blockComment && !quote && (carry === "'" || carry === '"' || carry === "`"))
      quote = carry;
  }
  if (quote || blockComment) throw new Error("SQL input ended inside a literal or block comment");
  if (statement.trim()) yield statement;
}
