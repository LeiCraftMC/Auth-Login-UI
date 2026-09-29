/**
 * proto-generate — regenerate the Zitadel v2 protobuf client in `server/lib/zitadel/proto/`.
 *
 * Pure JS/TS on purpose: no `buf`/`protoc` binary is needed (they are blocked on some dev
 * machines). The script
 *   1. reads the .proto files of the pinned Zitadel release (`ZITADEL_VERSION`) — from GitHub, or
 *      from a local checkout via `--proto-dir <path to zitadel/proto>` — starting at the services
 *      the login uses and following their imports,
 *   2. strips all custom options (HTTP/OpenAPI/validation annotations; they are irrelevant for the
 *      wire format) but keeps `deprecated`,
 *   3. parses the files with protobufjs and builds the `FileDescriptorProto`s the way protoc does
 *      (json names, proto3 `optional` as synthetic oneofs, map entries),
 *   4. runs the official `protoc-gen-es` plugin in-process (`target=ts`, `import_extension=none`).
 *
 * Bump `ZITADEL_VERSION` together with the Zitadel server and the login source it is ported from,
 * then run `bun run proto:generate`. Never hand-edit the generated `*_pb.ts` files.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { create, type DescFile } from "@bufbuild/protobuf";
import {
	CodeGeneratorRequestSchema,
	type DescriptorProto,
	DescriptorProtoSchema,
	type EnumDescriptorProto,
	EnumDescriptorProtoSchema,
	type FieldDescriptorProto,
	FieldDescriptorProto_Label,
	FieldDescriptorProto_Type,
	FieldDescriptorProtoSchema,
	type FileDescriptorProto,
	FileDescriptorProtoSchema,
	file_google_protobuf_any,
	file_google_protobuf_duration,
	file_google_protobuf_empty,
	file_google_protobuf_struct,
	file_google_protobuf_timestamp,
	file_google_protobuf_wrappers,
	OneofDescriptorProtoSchema,
	ServiceDescriptorProtoSchema,
} from "@bufbuild/protobuf/wkt";
// @ts-expect-error - protoc-gen-es ships no typings for its plugin entry point
import { protocGenEs } from "@bufbuild/protoc-gen-es/dist/cjs/src/protoc-gen-es-plugin.js";
import protobuf from "protobufjs";

const ZITADEL_VERSION = "v4.19.2";

const OUT_DIR = "server/lib/zitadel/proto";

/** Entry points; everything they import is generated too. */
const ROOT_FILES = [
	"zitadel/idp/v2/idp_service.proto",
	"zitadel/internal_permission/v2/internal_permission_service.proto",
	"zitadel/message.proto",
	"zitadel/oidc/v2/oidc_service.proto",
	"zitadel/org/v2/org_service.proto",
	"zitadel/saml/v2/saml_service.proto",
	"zitadel/session/v2/session_service.proto",
	"zitadel/settings/v2/settings_service.proto",
	"zitadel/user/v2/user_service.proto",
];

/** Imports that only carry custom options — dropped together with the options. */
const OPTION_ONLY_IMPORTS = [
	/^google\/api\//,
	/^protoc-gen-openapiv2\//,
	/^validate\//,
	/^zitadel\/protoc_gen_zitadel\//,
	/^google\/protobuf\/descriptor\.proto$/,
];

/** Well-known types: provided by @bufbuild/protobuf/wkt, never generated. */
const WKT_FILES: Record<string, DescFile> = {
	"google/protobuf/any.proto": file_google_protobuf_any,
	"google/protobuf/duration.proto": file_google_protobuf_duration,
	"google/protobuf/empty.proto": file_google_protobuf_empty,
	"google/protobuf/struct.proto": file_google_protobuf_struct,
	"google/protobuf/timestamp.proto": file_google_protobuf_timestamp,
	"google/protobuf/wrappers.proto": file_google_protobuf_wrappers,
};

const SCALAR_TYPES: Record<string, FieldDescriptorProto_Type> = {
	double: FieldDescriptorProto_Type.DOUBLE,
	float: FieldDescriptorProto_Type.FLOAT,
	int64: FieldDescriptorProto_Type.INT64,
	uint64: FieldDescriptorProto_Type.UINT64,
	int32: FieldDescriptorProto_Type.INT32,
	fixed64: FieldDescriptorProto_Type.FIXED64,
	fixed32: FieldDescriptorProto_Type.FIXED32,
	bool: FieldDescriptorProto_Type.BOOL,
	string: FieldDescriptorProto_Type.STRING,
	bytes: FieldDescriptorProto_Type.BYTES,
	uint32: FieldDescriptorProto_Type.UINT32,
	sfixed32: FieldDescriptorProto_Type.SFIXED32,
	sfixed64: FieldDescriptorProto_Type.SFIXED64,
	sint32: FieldDescriptorProto_Type.SINT32,
	sint64: FieldDescriptorProto_Type.SINT64,
};

// --- 1. Sources --------------------------------------------------------------

function isOptionOnlyImport(file: string) {
	return OPTION_ONLY_IMPORTS.some((re) => re.test(file));
}

async function readProtoSource(file: string, protoDir: string | null): Promise<string> {
	if (protoDir) {
		return readFileSync(path.join(protoDir, file), "utf8");
	}
	const url = `https://raw.githubusercontent.com/zitadel/zitadel/${ZITADEL_VERSION}/proto/${file}`;
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Could not download ${url}: HTTP ${res.status}`);
	}
	return res.text();
}

function parseImports(source: string): string[] {
	return Array.from(source.matchAll(/^\s*import\s+(?:public\s+|weak\s+)?"([^"]+)"\s*;/gm)).map(
		(m) => m[1] as string,
	);
}

/** Reads the root files and everything they import, returned in dependency order. */
async function collectSources(protoDir: string | null) {
	const sources = new Map<string, string>();
	const order: string[] = [];

	async function visit(file: string, trail: string[]) {
		if (sources.has(file) || WKT_FILES[file] || isOptionOnlyImport(file)) return;
		if (trail.includes(file)) {
			throw new Error(`Import cycle: ${[...trail, file].join(" -> ")}`);
		}
		const source = await readProtoSource(file, protoDir);
		for (const dep of parseImports(source)) {
			await visit(dep, [...trail, file]);
		}
		sources.set(file, source);
		order.push(file);
	}

	for (const file of ROOT_FILES) {
		await visit(file, []);
	}
	return { sources, order };
}

// --- 2. Option stripping -----------------------------------------------------

function skipString(src: string, start: number) {
	const quote = src[start];
	let i = start + 1;
	while (i < src.length && src[i] !== quote) {
		i += src[i] === "\\" ? 2 : 1;
	}
	return i + 1;
}

function skipComment(src: string, start: number) {
	if (src.startsWith("//", start)) {
		const end = src.indexOf("\n", start);
		return end === -1 ? src.length : end;
	}
	const end = src.indexOf("*/", start + 2);
	return end === -1 ? src.length : end + 2;
}

/** Index right after the `;` that ends the statement starting at `start` (depth-aware). */
function findStatementEnd(src: string, start: number) {
	let depth = 0;
	let i = start;
	while (i < src.length) {
		const ch = src[i] as string;
		if (ch === '"' || ch === "'") {
			i = skipString(src, i);
			continue;
		}
		if (src.startsWith("//", i) || src.startsWith("/*", i)) {
			i = skipComment(src, i);
			continue;
		}
		if ("{[(".includes(ch)) depth++;
		else if ("}])".includes(ch)) depth--;
		else if (ch === ";" && depth === 0) return i + 1;
		i++;
	}
	throw new Error("Unterminated option statement");
}

/** Index right after the `]` matching the `[` at `start`, plus the top-level comma-separated parts. */
function readBracketGroup(src: string, start: number) {
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	let i = start;
	while (i < src.length) {
		const ch = src[i] as string;
		if (ch === '"' || ch === "'") {
			const end = skipString(src, i);
			current += src.slice(i, end);
			i = end;
			continue;
		}
		if (src.startsWith("//", i) || src.startsWith("/*", i)) {
			i = skipComment(src, i);
			continue;
		}
		if ("{[(".includes(ch)) {
			depth++;
			if (depth === 1) {
				i++;
				continue;
			}
		} else if ("}])".includes(ch)) {
			depth--;
			if (depth === 0) {
				parts.push(current);
				return { end: i + 1, parts };
			}
		} else if (ch === "," && depth === 1) {
			parts.push(current);
			current = "";
			i++;
			continue;
		}
		current += ch;
		i++;
	}
	throw new Error("Unterminated field option list");
}

const isIdentChar = (ch: string | undefined) => !!ch && /[A-Za-z0-9_]/.test(ch);

/**
 * Removes every custom option (statements and `[...]` lists) except the semantic ones:
 * `deprecated = true` and `allow_alias = true`.
 */
function stripOptions(src: string) {
	let out = "";
	let i = 0;
	while (i < src.length) {
		const ch = src[i] as string;

		if (src.startsWith("//", i) || src.startsWith("/*", i)) {
			i = skipComment(src, i);
			continue;
		}
		if (ch === '"' || ch === "'") {
			const end = skipString(src, i);
			out += src.slice(i, end);
			i = end;
			continue;
		}
		if (src.startsWith("option", i) && !isIdentChar(src[i - 1]) && !isIdentChar(src[i + 6])) {
			const previous = out.trimEnd().slice(-1);
			if (previous === "" || previous === ";" || previous === "{" || previous === "}") {
				const end = findStatementEnd(src, i);
				const statement = src.slice(i, end).replace(/\s+/g, " ");
				const kept = statement.match(/^option (deprecated|allow_alias) ?= ?true ?;$/);
				if (kept) {
					out += `option ${kept[1]} = true;`;
				}
				i = end;
				continue;
			}
		}
		if (ch === "[") {
			const { end, parts } = readBracketGroup(src, i);
			const deprecated = parts.some((p) => p.replace(/\s+/g, "") === "deprecated=true");
			out += deprecated ? "[deprecated = true]" : "";
			i = end;
			continue;
		}
		out += ch;
		i++;
	}
	return out;
}

function stripOptionOnlyImports(src: string) {
	return src.replace(/^\s*import\s+(?:public\s+|weak\s+)?"([^"]+)"\s*;/gm, (line, file: string) =>
		isOptionOnlyImport(file) ? "" : line,
	);
}

// --- 3. Descriptors ----------------------------------------------------------

/** protoc's json_name derivation (ToJsonName in descriptor.cc). */
function toJsonName(name: string) {
	let result = "";
	let capitalizeNext = false;
	for (const ch of name) {
		if (ch === "_") {
			capitalizeNext = true;
		} else if (capitalizeNext) {
			result += ch.toUpperCase();
			capitalizeNext = false;
		} else {
			result += ch;
		}
	}
	return result;
}

/** protoc's map entry naming: `foo_bar` → `FooBarEntry`. */
function mapEntryName(fieldName: string) {
	const camel = toJsonName(fieldName);
	return `${camel.charAt(0).toUpperCase()}${camel.slice(1)}Entry`;
}

function typeRef(field: protobuf.Field) {
	const resolved = field.resolvedType;
	if (!resolved) {
		const scalar = SCALAR_TYPES[field.type];
		if (scalar === undefined) {
			throw new Error(`Unresolved type ${field.type} of ${field.fullName}`);
		}
		return { type: scalar };
	}
	return {
		type:
			resolved instanceof protobuf.Enum
				? FieldDescriptorProto_Type.ENUM
				: FieldDescriptorProto_Type.MESSAGE,
		typeName: resolved.fullName,
	};
}

function buildEnum(e: protobuf.Enum): EnumDescriptorProto {
	return create(EnumDescriptorProtoSchema, {
		name: e.name,
		value: Object.entries(e.values).map(([name, number]) => ({
			name,
			number,
			options: e.valuesOptions?.[name]?.deprecated ? { deprecated: true } : undefined,
		})),
		options:
			e.options?.deprecated || e.options?.allow_alias
				? {
						...(e.options?.deprecated ? { deprecated: true } : {}),
						...(e.options?.allow_alias ? { allowAlias: true } : {}),
					}
				: undefined,
	});
}

function buildMessage(type: protobuf.Type): DescriptorProto {
	const message = create(DescriptorProtoSchema, {
		name: type.name,
		options: type.options?.deprecated ? { deprecated: true } : undefined,
	});

	// protoc orders real oneofs by declaration and appends the synthetic proto3-optional ones.
	const realOneofs = type.oneofsArray.filter(
		(o) => !(o.fieldsArray.length === 1 && o.fieldsArray[0]?.options?.proto3_optional),
	);
	const syntheticOneofs = type.oneofsArray.filter((o) => !realOneofs.includes(o));
	const oneofs = [...realOneofs, ...syntheticOneofs];
	message.oneofDecl = oneofs.map((o) => create(OneofDescriptorProtoSchema, { name: o.name }));

	const mapEntries: DescriptorProto[] = [];

	for (const field of type.fieldsArray) {
		const descriptor: FieldDescriptorProto = create(FieldDescriptorProtoSchema, {
			name: field.name,
			number: field.id,
			jsonName: toJsonName(field.name),
			label: FieldDescriptorProto_Label.OPTIONAL,
			options: field.options?.deprecated ? { deprecated: true } : undefined,
		});

		if (field instanceof protobuf.MapField) {
			const entryName = mapEntryName(field.name);
			const keyType = SCALAR_TYPES[field.keyType];
			if (keyType === undefined) {
				throw new Error(`Invalid map key type ${field.keyType} of ${field.fullName}`);
			}
			mapEntries.push(
				create(DescriptorProtoSchema, {
					name: entryName,
					field: [
						{
							name: "key",
							number: 1,
							jsonName: "key",
							label: FieldDescriptorProto_Label.OPTIONAL,
							type: keyType,
						},
						{
							name: "value",
							number: 2,
							jsonName: "value",
							label: FieldDescriptorProto_Label.OPTIONAL,
							...typeRef(field),
						},
					],
					options: { mapEntry: true },
				}),
			);
			descriptor.label = FieldDescriptorProto_Label.REPEATED;
			descriptor.type = FieldDescriptorProto_Type.MESSAGE;
			descriptor.typeName = `${type.fullName}.${entryName}`;
		} else {
			const ref = typeRef(field);
			descriptor.type = ref.type;
			if (ref.typeName) descriptor.typeName = ref.typeName;
			if (field.repeated) descriptor.label = FieldDescriptorProto_Label.REPEATED;
		}

		if (field.partOf) {
			descriptor.oneofIndex = oneofs.indexOf(field.partOf);
			if (field.options?.proto3_optional) descriptor.proto3Optional = true;
		}

		message.field.push(descriptor);
	}

	for (const nested of type.nestedArray) {
		if (nested instanceof protobuf.Type) message.nestedType.push(buildMessage(nested));
		else if (nested instanceof protobuf.Enum) message.enumType.push(buildEnum(nested));
	}
	message.nestedType.push(...mapEntries);

	return message;
}

function buildFile(
	file: string,
	source: string,
	root: protobuf.Root,
	namespaces: Map<string, protobuf.ReflectionObject[]>,
): FileDescriptorProto {
	const pkg = source.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] ?? "";
	const descriptor = create(FileDescriptorProtoSchema, {
		name: file,
		package: pkg,
		syntax: "proto3",
		dependency: parseImports(source),
	});

	for (const obj of namespaces.get(file) ?? []) {
		if (obj instanceof protobuf.Type) descriptor.messageType.push(buildMessage(obj));
		else if (obj instanceof protobuf.Enum) descriptor.enumType.push(buildEnum(obj));
		else if (obj instanceof protobuf.Service) {
			descriptor.service.push(
				create(ServiceDescriptorProtoSchema, {
					name: obj.name,
					method: obj.methodsArray.map((m) => {
						m.resolve();
						const input = m.resolvedRequestType?.fullName;
						const output = m.resolvedResponseType?.fullName;
						if (!input || !output) throw new Error(`Unresolved rpc ${m.fullName}`);
						return {
							name: m.name,
							inputType: input,
							outputType: output,
							clientStreaming: !!m.requestStream,
							serverStreaming: !!m.responseStream,
							options: m.options?.deprecated ? { deprecated: true } : undefined,
						};
					}),
				}),
			);
		}
	}

	void root;
	return descriptor;
}

/** Top-level declarations per file, in declaration order. */
function collectTopLevel(root: protobuf.Root) {
	const byFile = new Map<string, protobuf.ReflectionObject[]>();
	const walk = (ns: protobuf.NamespaceBase) => {
		for (const obj of ns.nestedArray) {
			const isDeclaration =
				obj instanceof protobuf.Type || obj instanceof protobuf.Enum || obj instanceof protobuf.Service;
			if (isDeclaration && obj.filename) {
				const list = byFile.get(obj.filename) ?? [];
				list.push(obj);
				byFile.set(obj.filename, list);
			} else if (obj instanceof protobuf.Namespace && !isDeclaration) {
				walk(obj);
			}
		}
	};
	walk(root);
	return byFile;
}

// --- 4. Generation -----------------------------------------------------------

function argValue(name: string) {
	const index = process.argv.indexOf(name);
	return index === -1 ? null : (process.argv[index + 1] ?? null);
}

try {
	const protoDir = argValue("--proto-dir");
	console.log(
		`[proto-generate] Reading Zitadel ${ZITADEL_VERSION} protos from ${protoDir ?? "GitHub"} ...`,
	);

	const { sources, order } = await collectSources(protoDir);

	const root = new protobuf.Root();
	for (const wkt of ["any", "duration", "empty", "struct", "timestamp", "wrappers"]) {
		const json = protobuf.common.get(`google/protobuf/${wkt}.proto`);
		if (json) root.addJSON(json.nested as any);
	}

	const cleaned = new Map<string, string>();
	for (const file of order) {
		const source = stripOptionOnlyImports(stripOptions(sources.get(file) as string));
		cleaned.set(file, source);
		protobuf.parse.filename = file;
		protobuf.parse(source, root, { keepCase: true });
	}
	root.resolveAll();

	const topLevel = collectTopLevel(root);
	const files = order.map((file) => buildFile(file, cleaned.get(file) as string, root, topLevel));

	const request = create(CodeGeneratorRequestSchema, {
		fileToGenerate: order,
		parameter: "target=ts,import_extension=none",
		protoFile: [...Object.values(WKT_FILES).map((f) => f.proto), ...files],
		compilerVersion: { major: 0, minor: 0, patch: 0, suffix: "proto-generate.ts" },
	});

	const response = protocGenEs.run(request);
	if (response.error) {
		throw new Error(response.error);
	}

	rmSync(OUT_DIR, { recursive: true, force: true });
	for (const out of response.file) {
		const target = path.join(OUT_DIR, out.name);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, out.content);
	}
	writeFileSync(
		path.join(OUT_DIR, "README.md"),
		`# Generated Zitadel protos\n\nGenerated by \`bun run proto:generate\` from zitadel \`${ZITADEL_VERSION}\` (${order.length} files). Do not edit.\n`,
	);

	if (!existsSync(OUT_DIR)) throw new Error("No output was written");
	console.log(`[proto-generate] Wrote ${response.file.length} files to ${OUT_DIR}.`);
} catch (err: any) {
	console.error("[proto-generate] Failed:", err);
	process.exit(1);
}
