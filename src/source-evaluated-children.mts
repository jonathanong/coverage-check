/** Semantic operand positions; object keys and declaration bindings are deliberately absent. */
export const evaluatedChildFields: Readonly<Record<string, readonly string[]>> = {
  ExpressionStatement: ["expression"],
  VariableDeclarator: ["init"],
  AssignmentPattern: ["right"],
  ClassDeclaration: ["superClass"],
  ClassExpression: ["superClass"],
  CallExpression: ["callee", "arguments"],
  NewExpression: ["callee", "arguments"],
  ReturnStatement: ["argument"],
  ThrowStatement: ["argument"],
  UnaryExpression: ["argument"],
  UpdateExpression: ["argument"],
  AwaitExpression: ["argument"],
  YieldExpression: ["argument"],
  SpreadElement: ["argument"],
  BinaryExpression: ["left", "right"],
  LogicalExpression: ["left", "right"],
  AssignmentExpression: ["left", "right"],
  ConditionalExpression: ["test", "consequent", "alternate"],
  SequenceExpression: ["expressions"],
  ArrayExpression: ["elements"],
  MemberExpression: ["object", "property"],
  TemplateLiteral: ["expressions"],
  TaggedTemplateExpression: ["tag", "quasi"],
  ImportExpression: ["source", "options"],
  ChainExpression: ["expression"],
  IfStatement: ["test", "consequent", "alternate"],
  ForStatement: ["init", "test", "update", "body"],
  ForInStatement: ["right", "body"],
  ForOfStatement: ["right", "body"],
  WhileStatement: ["test", "body"],
  DoWhileStatement: ["body", "test"],
  SwitchStatement: ["discriminant", "cases"],
  SwitchCase: ["test", "consequent"],
  TryStatement: ["block", "handler", "finalizer"],
  CatchClause: ["body"],
  WithStatement: ["object", "body"],
  LabeledStatement: ["body"],
};

/** Synthetic JSX containers and pure function wrappers are not independent execution proof. */
export function hasRuntimeStart(type: string, evaluated: boolean): boolean {
  if (["ArrowFunctionExpression", "FunctionExpression"].includes(type)) return false;
  if (type === "ObjectExpression" || type === "ArrayExpression") return evaluated;
  return (
    type.endsWith("Expression") ||
    (type.endsWith("Statement") &&
      type !== "EmptyStatement" &&
      (type !== "BlockStatement" || evaluated)) ||
    ["CatchClause", "SwitchCase", "AssignmentPattern", "TemplateLiteral", "SpreadElement"].includes(
      type,
    ) ||
    (evaluated &&
      ["Identifier", "PrivateIdentifier", "Literal", "MetaProperty", "Super"].includes(type))
  );
}
