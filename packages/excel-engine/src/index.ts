/**
 * @flightdeck/excel-engine: the FlightDeck Excel simulator engine (FD-XLS01 spike).
 * See docs/architecture/EXCEL-ENGINE.md for the supported subset, semantics and security model.
 */
export {
  ENGINE_VERSION,
  DEFAULT_LIMITS,
  resolveLimits,
  isCellError,
  cellError,
  EngineError,
  LimitError,
  ParseError,
  type CellValue,
  type CellError,
  type ErrorCode,
  type Limits,
  type LimitKind,
} from "./types";
export {
  columnToLetters,
  lettersToColumn,
  parseCellRef,
  parseKey,
  toKey,
  normalizeRef,
  compareKeys,
  type CellAddress,
  type CellRefParts,
} from "./refs";
export { tokenize, type Token, type TokenType } from "./lexer";
export {
  parseFormula,
  astDepth,
  collectFunctions,
  collectReferences,
  isSupportedFunction,
  SUPPORTED_FUNCTIONS,
  type AstNode,
  type BinaryOp,
  type FunctionName,
  type ParseOptions,
} from "./parser";
export { evaluateAst, type EvalContext } from "./evaluator";
export { formatValue, formatNumber, toNumber, toText, compareValues, parseConstant } from "./values";
export { createWorkbook, evaluateSheet, type Workbook, type RecalcResult } from "./workbook";
export {
  validateSubmission,
  buildSubmission,
  checkExercise,
  exerciseLimits,
  matchesExpected,
  VALIDATOR_VERSION,
  MAX_SUBMISSION_BYTES,
  type ExerciseDefinition,
  type ExerciseKey,
  type ExpectedCheck,
  type ExpectedValue,
  type HiddenTest,
  type Submission,
  type ValidationCheck,
  type ValidationResult,
  type RejectCode,
  type CheckKind,
} from "./validator";
