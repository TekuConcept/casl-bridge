// test/chai-jest-snapshot.d.ts
declare global {
    export namespace Chai {
        interface Assertion {
            toMatchSnapshot(message?: string): Assertion
        }
    }
}

export {}
