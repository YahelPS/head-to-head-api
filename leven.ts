const array = [];
const characterCodeCache = [];

export default function leven(first, second) {
  if (first === second) {
    return 0;
  }

  const swap = first;

  if (first.length > second.length) {
    first = second;
    second = swap;
  }

  let firstLength = first.length;
  let secondLength = second.length;

  while (
    firstLength > 0 &&
    first.charCodeAt(~-firstLength) === second.charCodeAt(~-secondLength)
  ) {
    firstLength--;
    secondLength--;
  }

  let start = 0;

  while (
    start < firstLength &&
    first.charCodeAt(start) === second.charCodeAt(start)
  ) {
    start++;
  }

  firstLength -= start;
  secondLength -= start;

  if (firstLength === 0) {
    return secondLength;
  }

  let bCharacterCode;
  let result;
  let temporary;
  let temporary2;
  let index = 0;
  let index2 = 0;

  while (index < firstLength) {
    characterCodeCache[index] = first.charCodeAt(start + index);
    array[index] = ++index;
  }

  while (index2 < secondLength) {
    bCharacterCode = second.charCodeAt(start + index2);
    temporary = index2++;
    result = index2;

    for (index = 0; index < firstLength; index++) {
      temporary2 =
        bCharacterCode === characterCodeCache[index]
          ? temporary
          : temporary + 1;
      temporary = array[index];

      result = array[index] =
        temporary > result
          ? temporary2 > result
            ? result + 1
            : temporary2
          : temporary2 > temporary
          ? temporary + 1
          : temporary2;
    }
  }

  return result;
}
