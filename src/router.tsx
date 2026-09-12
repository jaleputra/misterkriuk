import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 menit cache valid (tidak refetch berulang-ulang)
        gcTime: 30 * 60 * 1000, // 30 menit disimpan di memori
        refetchOnWindowFocus: false, // JANGAN refetch setiap kali klik tab/pindah window
        refetchOnMount: false, // Gunakan cache jika data masih dalam staleTime
        refetchOnReconnect: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 5 * 60 * 1000,
  });

  return router;
};
