package com.example.neurolens.data.remote

import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object NetworkClient {
    private var currentBaseUrl = ""
    private var apiService: NeuroLensApiService? = null

    fun getService(baseUrl: String): NeuroLensApiService {
        // Clean URL to make sure it ends with / for Retrofit requirement
        val normalizedUrl = if (baseUrl.isBlank()) {
            "http://10.0.2.2:8000/"
        } else {
            val withProtocol = if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
                "http://$baseUrl"
            } else {
                baseUrl
            }
            if (withProtocol.endsWith("/")) withProtocol else "$withProtocol/"
        }

        if (apiService == null || currentBaseUrl != normalizedUrl) {
            currentBaseUrl = normalizedUrl
            apiService = buildRetrofit(normalizedUrl).create(NeuroLensApiService::class.java)
        }
        return apiService!!
    }

    private fun buildRetrofit(baseUrl: String): Retrofit {
        val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }

        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor(loggingInterceptor)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()

        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }
}
