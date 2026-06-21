package com.example.neurolens.data.remote

import com.example.neurolens.data.model.*
import okhttp3.MultipartBody
import retrofit2.http.*

interface NeuroLensApiService {

    @GET("/")
    suspend fun checkHealth(): Map<String, String>

    @POST("api/query")
    suspend fun queryDocuments(
        @Body request: QueryRequest
    ): RAGResponse

    @Multipart
    @POST("api/upload")
    suspend fun uploadFiles(
        @Part files: List<MultipartBody.Part>
    ): Map<String, Any>

    @POST("api/fetch-url")
    suspend fun fetchUrlContent(
        @Body request: FetchUrlRequest
    ): FetchUrlResponse

    @GET("api/documents")
    suspend fun getDocuments(): DocumentListResponse

    @POST("api/clear")
    suspend fun clearDatabase(): ClearResponse

    @POST("api/tts")
    suspend fun textToSpeech(
        @Body request: TTSRequest
    ): TTSResponse
}
