const std = @import("std");
// const zig_js = @import("zig-js");

pub fn build(b: *std.Build) void {
    const target = b.resolveTargetQuery(.{ .cpu_arch = .wasm32, .os_tag = .freestanding });

    const optimize = b.standardOptimizeOption(.{});

    const ziggy = b.dependency("ziggy", .{});
    // const zig_js_module = b.addModule("zig-js", .{ .root_source_file = b.path("zig-js/src/main.zig") });

    const wasm = b.addExecutable(.{
        .name = "ziggy-wasm",
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });

    wasm.root_module.addImport("ziggy", ziggy.module("ziggy"));
    // wasm.root_module.addImport("zig-js", zig_js_module);
    wasm.entry = .disabled;
    wasm.export_memory = true;
    wasm.root_module.export_symbol_names = &.{ "parse", "parseFree", "allocString", "freeString" };

    const wasm_install = b.addInstallFileWithDir(
        wasm.getEmittedBin(),
        .{ .custom = "../dist" },
        "ziggy.wasm",
    );

    const step = b.step("dist", "Build the wasm to dist");
    step.dependOn(&wasm_install.step);

    const test_target = b.standardTargetOptions(.{});
    const exe_unit_tests = b.addTest(.{
        .root_source_file = b.path("src/main.zig"),
        .target = test_target,
        .optimize = optimize,
    });
    exe_unit_tests.root_module.addImport("ziggy", ziggy.module("ziggy"));

    const run_lib_unit_tests = b.addRunArtifact(exe_unit_tests);

    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_lib_unit_tests.step);
}
