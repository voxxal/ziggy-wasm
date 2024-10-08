const std = @import("std");
const ziggy = @import("ziggy");
const dynamic = ziggy.dynamic;
const Parser = ziggy.Parser;

extern "dbg" fn print(u32) void;
extern "dbg" fn printMem([*]u8, usize, bool) void;
fn die(status: u32) noreturn {
    print(status);
    unreachable;
}

const allocator = std.heap.page_allocator;

// To be kept in sync with typescript
const Operation = enum(usize) {
    map, // one op (length)
    array, // one op (length)
    tag, // two ops (name, bytes)
    bytes, // one op (address)
    integer, // two ops (lb, hb)
    float, // two ops (lb, hb)
    bool, // one op (bool)
    null,
};

/// Slice with Guaranteed memory layout
fn SliceGuaranteed(comptime T: type) type {
    return extern struct {
        ptr: [*]T,
        len: usize,
    };
}

fn toGuaranteed(comptime T: type, items: []T) SliceGuaranteed(T) {
    return SliceGuaranteed(T){
        .ptr = items.ptr,
        .len = items.len,
    };
}

fn guarenteeSlice(comptime T: type, gpa: std.mem.Allocator, items: []T) *SliceGuaranteed(T) {
    const ret = gpa.create(SliceGuaranteed(T)) catch unreachable;
    ret.* = toGuaranteed(T, items);
    return ret;
}

var last_parse_arena: ?*std.heap.ArenaAllocator = null;
// Zig will create a third param if the return size is greater than
// 32 bits (in wasm32) so we need to return a pointer instead of a
// 64 bit value which SliceGuarenteed is.
export fn parse(source: [*]u8, len: usize) *const SliceGuaranteed(usize) {
    printMem(source, len, false);

    var arena = std.heap.ArenaAllocator.init(allocator);
    const gpa = arena.allocator();
    const res = Parser.parseLeaky(dynamic.Value, gpa, source[0..len :0], .{}) catch |e| {
        switch (e) {
            error.Overflow => die(255),
            error.OutOfMemory => die(0),
            error.Syntax => die(420),
        }
    };
    var ops = std.ArrayList(usize).init(gpa);
    buildValue(gpa, &ops, res) catch die(201);

    last_parse_arena = &arena;
    return guarenteeSlice(usize, gpa, ops.items);
}

export fn parseFree() void {
    if (last_parse_arena) |lpa| {
        lpa.deinit();
        last_parse_arena = null;
    }
}

export fn allocString(len: usize) [*]u8 {
    return (allocator.alloc(u8, len) catch unreachable).ptr;
}

export fn freeString(ptr: [*]u8, len: usize) void {
    allocator.free(ptr[0..len]);
}

fn buildValue(gpa: std.mem.Allocator, ops: *std.ArrayList(usize), value: dynamic.Value) !void {
    switch (value) {
        .kv => |map| {
            var fields_it = map.fields.iterator();
            try ops.append(@intFromEnum(Operation.map));
            try ops.append(map.fields.count());
            while (fields_it.next()) |entry| {
                try ops.append(@intFromPtr(entry.key_ptr));
                try buildValue(gpa, ops, entry.value_ptr.*);
            }
        },
        .array => |arr| {
            try ops.append(@intFromEnum(Operation.array));
            try ops.append(arr.len);
            for (arr) |e| {
                try buildValue(gpa, ops, e);
            }
        },
        .tag => |tag| {
            try ops.append(@intFromEnum(Operation.tag));
            try ops.append(@intFromPtr(guarenteeSlice(u8, gpa, @constCast(tag.name))));
            try buildValue(gpa, ops, dynamic.Value{ .bytes = tag.bytes });
        },
        .bytes => |bytes| {
            // TODO slice is stack allocated fix this!
            try ops.append(@intFromEnum(Operation.bytes));
            try ops.append(@intFromPtr(guarenteeSlice(u8, gpa, @constCast(bytes))));
        },
        .integer => |int| {
            try ops.append(@intFromEnum(Operation.integer));
            const lb: usize = @truncate(@as(u64, @bitCast(int)));
            const hb: usize = @truncate(@as(u64, @bitCast(int)) >> 32);

            try ops.append(lb);
            try ops.append(hb);
        },
        .float => |float| {
            try ops.append(@intFromEnum(Operation.float));
            const lb: usize = @truncate(@as(u64, @bitCast(float)));
            const hb: usize = @truncate(@as(u64, @bitCast(float)) >> 32);

            try ops.append(lb);
            try ops.append(hb);
        },

        .bool => |b| {
            try ops.append(@intFromEnum(Operation.bool));
            try ops.append(@as(usize, @intFromBool(b)));
        },
        .null => {
            try ops.append(@intFromEnum(Operation.null));
        },
    }
}

test "parse does not crash" {
    const slice = parse(@ptrCast("5"), 1);
    std.debug.print("{any}\n", .{slice});
    std.debug.print("{any}\n", .{slice.ptr[0..slice.len]});
}
