import { watch as fsWatch } from "fs";

const prod = Bun.argv.includes("production");
const watchMode = Bun.argv.includes("--watch");

async function build() {
	const [js, css] = await Promise.all([
		Bun.build({
			entrypoints: ["src/main.ts"],
			outdir: ".",
			naming: "main.js",
			format: "cjs",
			target: "browser",
			minify: prod,
			sourcemap: prod ? "none" : "inline",
			external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
			plugins: [
				{
					name: "css-stub",
					setup(build) {
						build.onResolve({ filter: /\.css$/ }, (args) => ({
							path: args.path,
							namespace: "css-stub",
						}));
						build.onLoad({ filter: /.*/, namespace: "css-stub" }, () => ({
							contents: "",
							loader: "js",
						}));
					},
				},
			],
		}),
		Bun.build({
			entrypoints: ["src/styles/main.css"],
			outdir: ".",
			naming: "styles.css",
			minify: prod,
		}),
	]);

	if (!js.success || !css.success) {
		for (const log of [...js.logs, ...css.logs]) console.error(log);
		return false;
	}
	return true;
}

function watch() {
	let timer: ReturnType<typeof setTimeout> | null = null;
	console.log("👀 Watching src/ for changes...");

	fsWatch("src", { recursive: true }, (_event, filename) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(async () => {
			timer = null;
			console.log(`\n↻ ${filename}`);
			const ok = await build();
			console.log(ok ? "✓ Rebuild" : "✗ Rebuild failed");
		}, 100);
	});
}

const ok = await build();
console.log(ok ? "✓ Build" : "✗ Build failed");
if (!ok && !watchMode) process.exit(1);

if (watchMode) watch();
