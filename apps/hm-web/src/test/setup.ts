import { cleanup } from "@testing-library/react";
import { afterEach } from "vite-plus/test";

// Testing Library only registers this itself when the test globals are on; they are not.
afterEach(cleanup);
